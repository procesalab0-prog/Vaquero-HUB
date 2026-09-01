# Identidad del cliente y tarjeta de lealtad

> Decisión transversal: afecta a M7 (clientes y lealtad), a la integración
> con WooCommerce y a la elección del lector de códigos.
>
> Última actualización: 2026-09-01.

## 1. El principio: la cuenta es opcional y perezosa

El registro del cliente y su cuenta de acceso son **dos cosas distintas**,
y ésa es la decisión central:

- **`customers`** existe siempre. Se crea en la primera compra, con o sin
  cuenta. Es el dueño del saldo de puntos y del historial.
- **La cuenta de acceso se crea sólo cuando el cliente realmente quiere
  entrar** a ver sus puntos. La mayoría nunca lo hará: irán a la tienda,
  darán su teléfono y acumularán puntos sin haber iniciado sesión jamás.

```sql
customers
  id                     uuid pk
  phone_e164             text unique   -- identidad principal, normalizada
  email                  text
  full_name              text
  birthdate              date          -- descuento de cumpleaños
  auth_user_id           uuid unique references auth.users  -- NULO casi siempre
  woocommerce_customer_id bigint unique
  ...
```

Esto resuelve las tres objeciones que existían contra darle cuenta al
cliente:

| Objeción | Cómo se resuelve |
|---|---|
| Supabase cobra por usuarios activos de Auth | Sólo se vuelve usuario de Auth quien de verdad inicia sesión. El costo escala con el uso real, no con el tamaño del padrón de clientes |
| Pedir registro en la caja mata el programa | En la caja nunca se pide cuenta. Se pide el teléfono, que toma tres segundos |
| Un cliente podría alcanzar datos internos | Ver sección 4 |

## 2. La identidad real es el teléfono, no la tarjeta

En México el teléfono es cómo la gente se identifica en una caja, y es la
llave natural para unir tienda física y tienda en línea. La tarjeta es una
comodidad encima de eso, no la identidad.

**Normalización obligatoria.** `353 123 4567`, `3531234567`,
`+52 353 123 4567` y `01 353 123 4567` son la misma persona. Se guarda
siempre en formato E.164 (`+523531234567`) con restricción de unicidad
sobre el valor normalizado. Sin esto se generan clientes duplicados con
saldos de puntos partidos, y recomponerlos después es un dolor.

## 3. La tarjeta en el teléfono: qué conviene construir

### 3.1 Lo que sí va en V1

1. **Búsqueda por teléfono en el POS.** La cajera teclea el número o los
   últimos cuatro dígitos. Funciona para todos, siempre, sin tarjeta, sin
   app y sin cuenta. Es el mecanismo universal y el que hay que hacer
   rápido.
2. **Página con su código QR**, accesible por un enlace firmado que se le
   manda por SMS o WhatsApp. El cliente la guarda en su pantalla de
   inicio. Sin contraseña.

### 3.2 Lo que conviene dejar para después

**Pase de Apple Wallet / Google Wallet.** Es la mejor experiencia —vive
en la cartera del teléfono, funciona sin señal y puede mostrar el saldo de
puntos actualizado— pero exige cuenta de desarrollador de Apple,
certificados de firma y un servicio web para actualizar los pases. Es
trabajo real y acotado, pero es *pulido*: no conviene construirlo antes de
saber si el programa de lealtad tiene tracción.

### 3.3 Advertencia de hardware

**Un lector láser de una dimensión no lee bien la pantalla de un
teléfono.** Si la tarjeta va a vivir en el celular, el lector Bluetooth
tiene que ser un **imager 2D**, no un láser lineal. Esto se cruza
directamente con la decisión de hardware pendiente: hay que definirlo
antes de comprar.

Y de todos modos conviene que la búsqueda por teléfono sea el camino
principal: una parte de la clientela no va a usar el celular para esto, y
así no hacen falta tarjetas físicas impresas.

## 4. Seguridad: el cliente y el empleado comparten Auth

Cuando un cliente crea su cuenta, queda en la misma tabla `auth.users` que
los empleados. **El modelo de M1 ya lo maneja correctamente**, y conviene
entender por qué:

`app.current_user_id()`, `app.has_perm()` y `app.can_access_location()`
todas parten de un registro en `app_users`. Un cliente no tiene registro
ahí, así que las tres devuelven nulo o falso, y **todas las políticas de
RLS lo niegan por construcción**. No hay que agregar nada para bloquearlo.

Dos reglas para que siga siendo cierto:

1. **Ninguna política se escribe jamás sobre `auth.uid() is not null`.**
   Estar autenticado no significa nada por sí solo. Toda política pasa por
   `app.has_perm()` o `app.can_access_location()`.
2. **El cliente no obtiene políticas directas sobre ninguna tabla.** Su
   acceso va por funciones `SECURITY DEFINER` dedicadas que sólo devuelven
   sus propios datos: su saldo, su historial, sus apartados.

## 5. Autenticación del cliente: sin contraseñas

Se usa **código por SMS o enlace mágico por correo**, nunca contraseña.

- El teléfono ya es la identidad; pedirle además una contraseña es
  redundante.
- Sin contraseña no hay contraseñas filtradas, ni relleno de credenciales,
  ni recuperación de acceso cayéndole al personal de la tienda.
- Supabase Auth lo soporta de forma nativa.

## 6. Cómo se conecta con WooCommerce

La regla del contexto maestro (sección 32) se sostiene: **Vaquero Hub es
dueño del cliente y del saldo de puntos; WooCommerce es un canal.**

- El cliente sigue entrando a la tienda en línea con su cuenta de
  WooCommerce. Vaquero Hub no necesita ser el login de la web.
- Al llegar un pedido en línea, se empareja al cliente por teléfono o
  correo normalizado. Si no existe, se crea el registro desde los datos
  del pedido.
- Los puntos ganados en línea caen en el **mismo saldo** que los de la
  tienda física, porque el saldo vive en Vaquero Hub.
- Se guarda `woocommerce_customer_id` para no volver a emparejar por texto
  después.

Todo esto es trabajo posterior al corte, pero el modelo de datos debe
admitirlo desde M7: `phone_e164`, `email`, `auth_user_id` y
`woocommerce_customer_id` existen desde que se crea la tabla, aunque se
llenen mucho más tarde.

## 7. Reglas de negocio todavía pendientes

Nada de esto se implementa hasta tener respuesta (bloquean M7):

1. ¿Cuántos puntos se ganan por peso gastado, y cuánto vale un punto al
   redimir?
2. ¿Los puntos expiran? ¿En cuánto tiempo?
3. ¿Se pueden ganar puntos en mercancía ya rebajada?
4. Si se devuelve una compra, ¿se retiran los puntos que generó?
5. ¿El descuento de cumpleaños es automático o lo autoriza un supervisor?
6. ¿Habrá niveles de cliente, o un solo esquema para todos?
