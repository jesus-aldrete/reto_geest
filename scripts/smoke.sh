#!/usr/bin/env bash
# Recorrido completo por todos los endpoints contra una API en marcha.
#
#   ./scripts/smoke.sh                        # contra http://localhost:3000
#   ./scripts/smoke.sh https://mi-api.fly.dev # contra la URL pública
#
# Verifica el hapy path, los errores y la idempotencia. Sale con código != 0
# si alguna comprobación falla.
set -uo pipefail

BASE="${1:-http://localhost:3000}"
STAMP="$(date +%s)-$RANDOM"
FAILED=0

# check <descripción> <status esperado> <status obtenido> <cuerpo>
check() {
	if [ "$2" = "$3" ]; then
		printf '  \033[32m✓\033[0m %s (HTTP %s)\n' "$1" "$3"
	else
		printf '  \033[31m✗\033[0m %s — esperado HTTP %s, obtenido %s\n     %s\n' "$1" "$2" "$3" "$4"
		FAILED=$((FAILED + 1))
	fi
}

# req <método> <ruta> [cuerpo] [header extra]
# Deja el cuerpo en $BODY y el status en $STATUS.
req() {
	local method="$1" path="$2" data="${3:-}" extra="${4:-}"
	local args=(-s -w '\n%{http_code}' -X "$method" "$BASE$path" -H 'content-type: application/json')
	[ -n "$data" ] && args+=(-d "$data")
	[ -n "$extra" ] && args+=(-H "$extra")
	local out; out="$(curl "${args[@]}")"
	STATUS="${out##*$'\n'}"
	BODY="${out%$'\n'*}"
}

json() { printf '%s' "$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const p='$2'.split('.');let v=o;for(const k of p)v=v?.[k];console.log(v===undefined?'':v)}catch{console.log('')}})"; }

echo "== Reto GEEST — verificación contra $BASE =="

echo; echo "-- Salud"
req GET /health
check "GET /health responde" 200 "$STATUS" "$BODY"

echo; echo "-- Usuarios"
req POST /users "{\"name\":\"Ana\",\"lastName\":\"Ruiz\",\"email\":\"ana-$STAMP@example.com\"}"
check "POST /users crea un usuario" 201 "$STATUS" "$BODY"
U1="$(json "$BODY" id)"

req POST /users "{\"name\":\"Luis\",\"lastName\":\"Paz\",\"email\":\"luis-$STAMP@example.com\"}"
check "POST /users crea un segundo usuario" 201 "$STATUS" "$BODY"
U2="$(json "$BODY" id)"

req POST /users "{\"name\":\"Sin\",\"lastName\":\"Correo\",\"email\":\"no-es-correo\"}"
check "POST /users rechaza un correo inválido" 400 "$STATUS" "$BODY"

req POST /users "{\"name\":\"Falta\"}"
check "POST /users rechaza campos obligatorios ausentes" 400 "$STATUS" "$BODY"

req GET /users
check "GET /users lista usuarios" 200 "$STATUS" "$BODY"

echo; echo "-- Tareas"
req POST /tasks '{"title":"Tarea de verificación","description":"Creada por smoke.sh"}'
check "POST /tasks crea una tarea" 201 "$STATUS" "$BODY"
T1="$(json "$BODY" id)"
[ "$(json "$BODY" status)" = "open" ] \
	&& printf '  \033[32m✓\033[0m la tarea nace con estado "open"\n' \
	|| { printf '  \033[31m✗\033[0m la tarea no nació con estado "open"\n'; FAILED=$((FAILED + 1)); }

req POST /tasks '{"description":"sin título"}'
check "POST /tasks rechaza una tarea sin título" 400 "$STATUS" "$BODY"

req POST "/tasks/$T1/assign" "{\"userIds\":[$U1,$U2]}"
check "POST /tasks/:id/assign asigna dos usuarios" 200 "$STATUS" "$BODY"

req POST "/tasks/$T1/assign" "{\"userIds\":[$U1]}"
check "POST /tasks/:id/assign no duplica una asignación existente" 200 "$STATUS" "$BODY"

req POST "/tasks/$T1/assign" '{"userIds":[999999]}'
check "POST /tasks/:id/assign rechaza usuarios inexistentes" 404 "$STATUS" "$BODY"

req POST "/tasks/999999/assign" "{\"userIds\":[$U1]}"
check "POST /tasks/:id/assign rechaza tareas inexistentes" 404 "$STATUS" "$BODY"

echo; echo "-- Completado y archivado"
req POST "/tasks/$T1/complete" "{\"userId\":$U1}"
check "POST /tasks/:id/complete marca la parte del primer usuario" 200 "$STATUS" "$BODY"
[ "$(json "$BODY" taskStatus)" = "open" ] \
	&& printf '  \033[32m✓\033[0m la tarea sigue abierta con usuarios pendientes\n' \
	|| { printf '  \033[31m✗\033[0m la tarea cambió de estado antes de tiempo\n'; FAILED=$((FAILED + 1)); }

req POST "/tasks/$T1/complete" '{"userId":999999}'
check "POST /tasks/:id/complete rechaza usuarios inexistentes" 404 "$STATUS" "$BODY"

req POST /tasks '{"title":"Tarea ajena"}'
T2="$(json "$BODY" id)"
req POST "/tasks/$T2/complete" "{\"userId\":$U1}"
check "POST /tasks/:id/complete rechaza a un usuario no asignado" 400 "$STATUS" "$BODY"

req POST "/tasks/$T1/complete" "{\"userId\":$U2}"
check "POST /tasks/:id/complete archiva al terminar el último usuario" 200 "$STATUS" "$BODY"
[ "$(json "$BODY" taskStatus)" = "archived" ] \
	&& printf '  \033[32m✓\033[0m la tarea quedó archivada\n' \
	|| { printf '  \033[31m✗\033[0m la tarea no quedó archivada\n'; FAILED=$((FAILED + 1)); }

echo; echo "-- Consultas"
req GET "/tasks/$T1"
check "GET /tasks/:id devuelve el detalle" 200 "$STATUS" "$BODY"
req GET "/tasks?status=archived"
check "GET /tasks?status=archived filtra" 200 "$STATUS" "$BODY"
req GET "/tasks?status=open"
check "GET /tasks?status=open filtra" 200 "$STATUS" "$BODY"
req GET "/tasks?status=inventado"
check "GET /tasks rechaza un status desconocido" 400 "$STATUS" "$BODY"
req GET "/users/$U1/tasks"
check "GET /users/:id/tasks lista las tareas del usuario" 200 "$STATUS" "$BODY"
req GET /tasks/999999
check "GET /tasks/:id devuelve 404 si no existe" 404 "$STATUS" "$BODY"

echo; echo "-- Notificaciones"
sleep 2
req GET "/tasks/$T1/notifications"
check "GET /tasks/:id/notifications lista los intentos" 200 "$STATUS" "$BODY"
printf '     intentos registrados: %s\n' "$(json "$BODY" totalAttempts)"

echo; echo "-- Idempotencia"
KEY="smoke-$STAMP"
BODY_U="{\"name\":\"Idem\",\"lastName\":\"Potente\",\"email\":\"idem-$STAMP@example.com\"}"
req POST /users "$BODY_U" "Idempotency-Key: $KEY"
check "primer POST con Idempotency-Key" 201 "$STATUS" "$BODY"
ID_A="$(json "$BODY" id)"
req POST /users "$BODY_U" "Idempotency-Key: $KEY"
check "POST repetido con la misma clave" 201 "$STATUS" "$BODY"
ID_B="$(json "$BODY" id)"
[ "$ID_A" = "$ID_B" ] \
	&& printf '  \033[32m✓\033[0m la operación se ejecutó una sola vez (mismo id: %s)\n' "$ID_A" \
	|| { printf '  \033[31m✗\033[0m se crearon dos usuarios distintos: %s y %s\n' "$ID_A" "$ID_B"; FAILED=$((FAILED + 1)); }

req POST /users "{\"name\":\"Otro\",\"lastName\":\"Cuerpo\",\"email\":\"otro-$STAMP@example.com\"}" "Idempotency-Key: $KEY"
check "misma clave con cuerpo distinto se rechaza" 409 "$STATUS" "$BODY"

echo; echo "-- Idempotencia en paralelo"
PKEY="par-$STAMP"
PBODY="{\"title\":\"Tarea paralela $STAMP\"}"
for _ in 1 2 3 4 5; do
	curl -s -X POST "$BASE/tasks" -H 'content-type: application/json' -H "Idempotency-Key: $PKEY" -d "$PBODY" &
done > /tmp/geest-par-$STAMP.txt
wait
UNIQ="$(grep -o '"id":[0-9]*' /tmp/geest-par-$STAMP.txt | sort -u | wc -l | tr -d ' ')"
rm -f /tmp/geest-par-$STAMP.txt
[ "$UNIQ" = "1" ] \
	&& printf '  \033[32m✓\033[0m 5 requests en paralelo crearon una sola tarea\n' \
	|| { printf '  \033[31m✗\033[0m 5 requests en paralelo crearon %s tareas distintas\n' "$UNIQ"; FAILED=$((FAILED + 1)); }

echo; echo "-- Mejora extra: bitácora de auditoría"
req GET "/tasks/$T1/events"
check "GET /tasks/:id/events devuelve la bitácora" 200 "$STATUS" "$BODY"

echo
if [ "$FAILED" -eq 0 ]; then
	printf '\033[32m== Todas las comprobaciones pasaron ==\033[0m\n'
else
	printf '\033[31m== %s comprobación(es) fallaron ==\033[0m\n' "$FAILED"
fi
exit "$FAILED"
