# Referencia de la API

Base: `http://localhost:3000` en local, o la URL pública del despliegue.
Todos los cuerpos son JSON (`content-type: application/json`).

## Formato de error

Cualquier error responde con esta forma, en cualquier endpoint:

```json
{ "error": { "code": "TASK_NOT_FOUND", "message": "No existe una tarea con id 42." } }
```

Los errores de validación añaden `error.details` con el detalle campo a campo.

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Falta un campo obligatorio o su tipo/formato es inválido |
| `INVALID_JSON` | 400 | El cuerpo no es JSON válido |
| `USER_NOT_ASSIGNED` | 400 | El usuario no está asignado a la tarea que intenta completar |
| `USER_NOT_FOUND` | 404 | Uno o más usuarios no existen |
| `TASK_NOT_FOUND` | 404 | La tarea no existe |
| `NOT_FOUND` | 404 | Ruta inexistente |
| `EMAIL_ALREADY_EXISTS` | 409 | Ya hay un usuario con ese correo |
| `TASK_ALREADY_ARCHIVED` | 409 | Se intenta asignar usuarios a una tarea ya archivada |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Mismo `Idempotency-Key` con un cuerpo distinto |
| `REQUEST_IN_PROGRESS` | 409 | Hay un request en curso con ese `Idempotency-Key` |
| `INTERNAL_ERROR` | 500 | Error inesperado |

## Endpoints

### `POST /users` → 201

```jsonc
// Body
{ "name": "Ana", "lastName": "Ruiz", "email": "ana@example.com" }
// Respuesta
{ "id": 1, "name": "Ana", "lastName": "Ruiz", "email": "ana@example.com", "createdAt": "..." }
```

El correo se normaliza a minúsculas y debe ser único.

### `POST /tasks` → 201

```jsonc
// Body — title obligatorio, description opcional
{ "title": "Migrar la API", "description": "Pasar a Node" }
// Respuesta
{ "id": 1, "title": "Migrar la API", "description": "Pasar a Node", "status": "open",
  "createdAt": "...", "updatedAt": "...", "archivedAt": null,
  "assignees": [], "completedCount": 0, "totalAssignees": 0 }
```

### `POST /tasks/:idTask/assign` → 200

```jsonc
// Body
{ "userIds": [1, 2, 3] }
// Respuesta
{ "message": "Usuarios asignados correctamente.", "taskId": 1,
  "assigned": [1, 2], "alreadyAssigned": [3], "assignees": [ /* ... */ ] }
```

Si algún usuario no existe, no se asigna ninguno (la transacción se revierte).
Reasignar a alguien ya asignado no duplica la relación: aparece en `alreadyAssigned`.

### `POST /tasks/:idTask/complete` → 200

```jsonc
// Body
{ "userId": 1 }
// Respuesta
{ "message": "Parte de la tarea marcada como completada.", "taskId": 1, "userId": 1,
  "completedAt": "...", "taskStatus": "archived", "archived": true, "pendingUsers": [] }
```

Cuando `pendingUsers` queda vacío, la tarea pasa a `archived` y se encola la
notificación al sistema del cliente.

### `GET /tasks?status=open|archived` → 200

```jsonc
{ "tasks": [ { "id": 1, "title": "...", "status": "open",
               "assignees": [ { "userId": 1, "name": "Ana", "completed": true, "completedAt": "..." } ],
               "completedCount": 1, "totalAssignees": 2 } ] }
```

Sin el parámetro `status` devuelve todas las tareas.

### `GET /users` → 200

```jsonc
{ "users": [ { "id": 1, "name": "Ana", "lastName": "Ruiz", "email": "ana@example.com",
               "pendingTasksCount": 1,
               "pendingTasks": [ { "id": 1, "title": "...", "status": "open", "assignedAt": "..." } ] } ] }
```

Pendiente = asignada y con la parte de ese usuario sin terminar.

### `GET /users/:idUser/tasks` → 200

```jsonc
{ "userId": 1, "tasks": [ { "id": 1, "title": "...", "status": "open",
                            "completed": false, "completedAt": null, "assignedAt": "..." } ] }
```

### `GET /tasks/:idTask` → 200

Devuelve la tarea completa con `assignees`, cada uno con su bandera `completed`.

### `GET /tasks/:idTask/notifications` → 200

```jsonc
{ "taskId": 1,
  "status": "delivered",          // not_scheduled | pending | delivering | delivered | failed
  "attempts": [
    { "attempt": 1, "status": "failed",  "httpStatus": 500, "error": "...", "url": "...",
      "durationMs": 17, "timestamp": "..." },
    { "attempt": 2, "status": "success", "httpStatus": 200, "error": null,  "url": "...",
      "durationMs": 4,  "timestamp": "..." }
  ],
  "totalAttempts": 2,
  "payload": { "taskId": 1, "title": "...", "archivedAt": "..." },
  "nextAttemptAt": null }
```

`status: "not_scheduled"` significa que la tarea aún no se ha archivado.

### `GET /tasks/:idTask/events` → 200 *(mejora extra)*

```jsonc
{ "taskId": 1, "events": [
    { "id": 1, "type": "task.created",        "userId": null, "payload": { "title": "..." },        "createdAt": "..." },
    { "id": 2, "type": "task.assigned",       "userId": null, "payload": { "userIds": [1, 2] },     "createdAt": "..." },
    { "id": 3, "type": "task.part_completed", "userId": 1,    "payload": { "completedAt": "..." },  "createdAt": "..." },
    { "id": 4, "type": "task.archived",       "userId": 2,    "payload": { "archivedAt": "..." },   "createdAt": "..." },
    { "id": 5, "type": "notification.delivered", "userId": null, "payload": { "attempt": 1, "httpStatus": 200 }, "createdAt": "..." }
] }
```

### `GET /health` → 200

Sonda de salud usada por el health check del proveedor de hosting.

## Idempotencia

Todos los `POST` aceptan el header opcional `Idempotency-Key`:

```bash
curl -X POST "$BASE/users" \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: 5f3a-c001' \
  -d '{"name":"Ana","lastName":"Ruiz","email":"ana@example.com"}'
```

Repetir el request con la misma clave **y el mismo cuerpo** devuelve exactamente
la misma respuesta (mismo status, mismo JSON) sin volver a ejecutar la
operación; las repeticiones traen el header `Idempotency-Replayed: true`.
La misma clave con un cuerpo distinto responde `409 IDEMPOTENCY_KEY_REUSED`.

La clave tiene alcance por endpoint: `(clave, método, ruta)`. Reutilizarla en
`POST /users` y en `POST /tasks` no colisiona.
