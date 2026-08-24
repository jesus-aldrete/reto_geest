# Reto GEEST — API de gestión de tareas

API REST en Node.js + TypeScript sobre SQLite. Crea tareas, las asigna a varias
personas y, cuando todas terminan su parte, archiva la tarea y notifica al
sistema del cliente con reintentos.

- **URL pública:** <https://geest-task-api.fly.dev> → ver [Despliegue](#despliegue).
- **Endpoints en detalle:** [`docs/api.md`](docs/api.md) · **UML:** [`docs/uml-database.md`](docs/uml-database.md) · **Esquema SQL:** [`db/migrations/`](db/migrations/)

## Ejecutar en local

Requisitos: Node.js ≥ 20 (probado en 22).

```bash
npm install
cp .env.example .env      # ajusta NOTIFY_URL para recibir las notificaciones
npm run migrate           # crea la base y aplica las migraciones
npm run dev               # http://localhost:3000
```

Producción: `npm run build && npm start`.
Docker: `docker build -t geest-api . && docker run -p 3000:3000 -v geest_data:/data geest-api`.

| Comando | Qué hace |
|---|---|
| `npm test` | **Ejecuta los 94 tests automatizados** |
| `npm run dev` / `npm run migrate` / `npm run seed` | Desarrollo · migraciones · datos de ejemplo |
| `./scripts/smoke.sh [URL]` | Recorre todos los endpoints contra una API en marcha |

## Decisiones técnicas

**SQLite con `better-sqlite3`.** Base SQL real, con transacciones ACID y
restricciones declarativas, sin un servicio externo que mantener vivo durante la
ventana de evaluación. Su API síncrona ayuda: dentro de una petición no hay
puntos de suspensión por donde otra pueda colarse. El coste es que no escala a
varias instancias escritoras; migrar a Postgres apenas tocaría el código, porque
toda la concurrencia se resuelve con SQL estándar.

**Migraciones versionadas.** `db/migrations/` es la fuente de verdad y se aplica
sola al arrancar: desplegar nunca requiere un paso manual. `db/schema.sql` es
sólo una fotografía legible del esquema.

**Las garantías viven en la base, no en el código.** Se sostienen aunque el
proceso muera a mitad o haya dos instancias:

1. *Archivar exactamente una vez* — `UPDATE tasks SET status='archived' WHERE id=? AND status='open'`.
   Si dos usuarios completan a la vez, las transacciones se serializan y sólo una
   ve `changes === 1`: sólo esa archiva y sólo esa encola la notificación.
2. *Notificar exactamente una vez* — `UNIQUE(task_id)` en `notification_outbox`.
3. *No duplicar asignaciones* — PK compuesta `(task_id, user_id)`.

**Patrón outbox para notificar.** Archivar y encolar la notificación ocurren en la
misma transacción; un worker la entrega después. Así `POST /complete` no espera a
un sistema externo y un reinicio a mitad del envío no pierde nada: al arrancar,
el worker retoma lo pendiente. Reintentos a 1 s y 2 s (backoff exponencial) hasta
3 intentos, cada uno registrado con número, timestamp y status HTTP en
`GET /tasks/:idTask/notifications`.

**Idempotencia con la respuesta guardada.** `idempotency_keys` tiene PK
`(clave, método, ruta)`: ese `INSERT` es la sección crítica que sólo un request
gana. El ganador ejecuta y guarda status y cuerpo exactos; los duplicados los
reproducen. Si el original sigue en vuelo, el duplicado espera su respuesta, de
modo que dos requests en paralelo responden idéntico. El hash es del cuerpo
canonicalizado (claves ordenadas), así que reordenar campos no rompe nada. Las
5xx no se cachean: liberan la clave para que el reintento sea real.

## Supuestos ante ambigüedades

- **`Idempotency-Key` es opcional**: el enunciado pide *aceptarlo*; exigirlo
  rompería a los clientes que no lo envían.
- **Misma clave con distinto cuerpo → 409**: es un error del cliente, y tanto
  ejecutar como reproducir la respuesta anterior serían peligrosos.
- **Los errores también se cachean** (salvo 5xx): "ambas respuestas idénticas"
  incluye las de error.
- **Una tarea archivada no admite nuevas asignaciones** (409): permitirlo dejaría
  una tarea archivada con partes sin terminar.
- **Repetir `complete` sin clave no es error**: devuelve 200 con el `completedAt`
  original, sin reescribir ni volver a archivar.
- **"Tareas pendientes" de un usuario** = asignadas con *su* parte sin terminar.
- **Correo único, normalizado a minúsculas**; duplicado → 409.
- **Sin autenticación**: no se pide y el `userId` viaja en el cuerpo. En producción,
  `complete` debería tomar la identidad del token.
- **Timestamps ISO-8601 UTC**, como el ejemplo del enunciado.
- **Un 4xx del destino no se reintenta**: sólo 5xx o ausencia de respuesta.

## Mejora extra: bitácora de auditoría por tarea

`GET /tasks/:idTask/events` devuelve la historia completa e inmutable de una
tarea: creación, asignaciones, quién completó su parte y cuándo, archivado y
desenlace de la notificación.

**Qué problema resuelve.** El estado que expone la API es una foto del *ahora*:
dice que la tarea está archivada, pero no quién la cerró ni en qué orden. Las
preguntas caras en un sistema de trabajo compartido son las históricas —"¿quién
marcó esto como terminado?", "¿se llegó a notificar al cliente?"— y hoy sólo se
responden leyendo logs de servidor, que rotan y no están ligados a la tarea.

**Por qué la consideré necesaria.** El producto ya toma una decisión automática e
irreversible: archivar y notificar a un tercero. En cuanto algo es automático e
irreversible, alguien preguntará por qué ocurrió; sin bitácora la respuesta es
"no se puede saber", y el archivado automático deja de ser fiable en la práctica
aunque el código sea correcto.

**Por qué esta y no otra.** Consideré autenticación, paginación y rate limiting.
La autenticación es transversal y habría tocado todos los endpoints, y el
enunciado pide que la mejora no afecte a lo anterior; paginación y rate limiting
son prematuros a este volumen. La bitácora es puramente aditiva —una tabla y un
endpoint nuevos, sin tocar ningún contrato— y refuerza justo lo que el reto
señala como delicado. Los eventos se escriben en la *misma transacción* que el
cambio que describen, así que no pueden desincronizarse de la realidad.

## Tests

`npm test` — 94 tests (Vitest + Supertest) sobre la API HTTP completa y una base
SQLite real, aislada por fichero de test. Cubren endpoints y errores, la
idempotencia incluyendo requests en paralelo, el archivado único bajo
concurrencia —también entre dos conexiones distintas a la misma base—, los
reintentos con backoff y su registro, el transporte HTTP real contra un servidor
de prueba, y la mejora extra.

## Despliegue

**Desplegado en Fly.io:** <https://geest-task-api.fly.dev>

Verificado contra la URL pública con `./scripts/smoke.sh` —todas las
comprobaciones en verde— y con un reinicio de máquina para confirmar que los
datos sobreviven: el volumen persistente es lo que permite usar SQLite como base
real y no como un caché que se borra en cada despliegue.

```bash
fly apps create geest-task-api                       # fly launch reescribiría fly.toml
fly volumes create geest_data --size 1 --region dfw
fly secrets set NOTIFY_URL="https://webhook.site/tu-uuid"
fly deploy --remote-only --ha=false
./scripts/smoke.sh https://geest-task-api.fly.dev
```

> **Con SQLite debe correr una sola instancia escritora** (`min_machines_running = 1`,
> sin autoescalado). De ahí el `--ha=false`: sin él Fly levanta una segunda máquina
> por defecto y solo una puede montar el volumen. Para escalar horizontalmente
> habría que migrar a Postgres.

## Qué queda fuera

- **`NOTIFY_URL` en el despliegue**: corre sin receptor configurado, así que al
  archivar una tarea el intento queda registrado como fallido
  (`NOTIFY_URL_NOT_CONFIGURED`); se activa con `fly secrets set NOTIFY_URL=...`.
  En local sí está verificado de punta a punta, incluido el envío real de la
  notificación a un receptor HTTP y sus reintentos ante errores 5xx.
- **Autenticación**: cualquiera puede completar la parte de cualquiera.
- **Paginación**: `GET /tasks` y `GET /users` devuelven todo.
- **Limpieza de claves de idempotencia**: la tabla crece sin límite; falta un
  proceso que borre las de más de 24 h.
- **Reintento manual de notificaciones agotadas**: un `POST .../notifications/retry`
  sería el siguiente paso natural.
