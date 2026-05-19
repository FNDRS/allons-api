# Fase 6 — Producción, Hardening y Cumplimiento (API)

Este documento cubre los cambios de hardening que dependen del backend (`allons-api`) y el runbook operativo para operar pagos en **dev / stg / prod**.

## 1) Ambientes (dev / stg / prod)

Paygate (Clinpays) ofrece entornos separados. Allons debe reflejarlo con variables por ambiente.

Variables mínimas:

- `PAYGATE_API_BASE`
  - `https://stage.paygatehn.com` (stg)
  - `https://api.paygatehn.com` (prod)
- `PAYGATE_BEARER_TOKEN`
- `PAYGATE_WEBHOOK_SECRET`
- `ADMIN_API_SECRET` (para endpoints admin)

Feature flags (rollback rápido):

- `PAYMENTS_ENABLED=true|false`
- `FORCE_FREE_EVENTS=true|false`

Recomendación:

- Mantener **stg** y **prod** en cuentas/servicios separados (o al menos parámetros/secrets separados).
- Usar un naming claro por ambiente en el gestor de secretos: `*_DEV`, `*_STG`, `*_PROD`.

## 2) Feature Flags

Comportamiento:

- `PAYMENTS_ENABLED=false` o `FORCE_FREE_EVENTS=true`.
  - `POST /me/payments/initiate` retorna **503** con mensaje `Pagos temporalmente deshabilitados`.

Objetivo:

- Permitir rollback instantáneo sin redeploy: deshabilitar cobros nuevos mientras se mantiene el resto de la app.

## 3) Rate Limiting (API)

Se habilita rate limiting con `@nestjs/throttler`.

Política actual:

- Global (baseline): `200 req / 60s` por tracker.
- `POST /me/payments/initiate`: `10 req / 60s`.
- `POST /webhooks/paygate`: `600 req / 60s`.

Tracker:

- Si el request tiene `req.userId` (lo adjuntan controladores autenticados), usa `u:<userId>`.
- Si no, cae a `ip:<req.ip>` (con `trust proxy` habilitado en producción).

Nota:

- En cluster/multi-instancia, el throttling en memoria es aproximado. Para precisión se debe migrar a storage compartido (Redis).

## 4) Antifraude básico (API)

`POST /me/payments/initiate` bloquea spam de órdenes:

- Si el usuario tiene `>= 3` órdenes `pending_payment` creadas en los últimos `10 minutos`, devuelve **429**.

## 5) Minimización de logs

En `NODE_ENV=production` mantenemos logs de transacciones (nivel `log`) además de `warn/error`.

Reglas:

- No loguear payloads de Paygate completos.
- No loguear secrets/tokens.
- No loguear PII (emails, teléfonos, nombres). Usar identificadores internos (`orderId`, `eventId`, `userId`).

Implementación:

- `ObservabilityService` emite eventos JSON con sanitización para CloudWatch/Insights.

## 6) Retención de logs (operación)

AWS (CloudWatch Logs):

- Retención sugerida:
  - `stg`: 7–14 días
  - `prod`: 30 días
- Export/Archive opcional a S3 si legal/operaciones requiere histórico.

## 7) Rotación de secretos (sin downtime)

### PAYGATE_BEARER_TOKEN

1. Rotar primero en **stg**.
1. Publicar nuevo token en el gestor de secretos (`PAYGATE_BEARER_TOKEN_STG`) y redeploy.
1. Smoke test:
   - `POST /me/payments/initiate` debe crear link.
   - Pago sandbox: webhook debe marcar orden.
1. Repetir en **prod**.

Plan de rollback:

- Mantener el token anterior disponible temporalmente para revertir rápido.

### PAYGATE_WEBHOOK_SECRET

Paygate normalmente solo permite **un secret activo** por webhook.

Procedimiento recomendado:

1. En **stg**: cambiar secret en portal Paygate y actualizar `PAYGATE_WEBHOOK_SECRET_STG`.
1. Validar firma con un webhook real.
1. En **prod**: coordinar ventana corta.
1. Cambiar secret en portal Paygate y actualizar `PAYGATE_WEBHOOK_SECRET_PROD`.
1. Monitorear inmediatamente:
   - tasa de 401 en `/webhooks/paygate`
   - órdenes `pending_payment` que crecen sin moverse.

Nota: si Paygate soporta “rollover secret” (2 secrets válidos), se puede hacer doble-validación sin ventana. Si no, la ventana es el tiempo entre aplicar ambos cambios.

## 8) Webhook IP allowlist

La documentación Paygate v1.2.1 revisada no incluye rangos de IP oficiales para allowlist.

Acción:

- Solicitar a Paygate/Clinpays soporte: lista de IPs salientes de webhooks (stg y prod).
- Hasta tener IPs oficiales, NO aplicar allowlist estricta a nivel de red (podría cortar pagos).
