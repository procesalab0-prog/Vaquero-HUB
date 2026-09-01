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

## 3. La tarjeta en el teléfono: una segunda PWA

La tarjeta de lealtad vive en una **PWA propia para clientes**, construida
desde el mismo código y el mismo despliegue que el sistema interno, pero
en un **subdominio aparte**.

### 3.1 Por qué subdominio y no una ruta `/cliente`

Dos PWA en el mismo origen se pueden separar por alcance de manifiesto,
pero comparten almacenamiento, cookies y service worker. Eso trae dos
problemas concretos:

1. **Sesiones mezcladas.** Si una cajera abre la vista de cliente en el
   iPad de la tienda para ayudar a alguien a registrarse, esa sesión de
   cliente queda en el mismo almacenamiento que la sesión del personal.
   Con orígenes distintos, esa clase de problema no existe.
2. **Instalación limpia.** Cada origen instala su propia PWA con su propio
   ícono, su propio service worker y su propio almacenamiento, sin trucos
   de alcance.

Propuesta: `hub.<dominio>` para el sistema interno y `mi.<dominio>` (o
`puntos.<dominio>`) para clientes. Un solo proyecto de Next.js y un solo
despliegue en Vercel resuelven ambos.

### 3.2 Qué muestra la PWA de cliente

Las tres representaciones del **mismo número de socio**, juntas en una
pantalla:

| Representación | Para qué sirve | Nota |
|---|---|---|
| **QR** | Lectura principal en caja | Requiere lector imager 2D |
| **Código de barras 1D** | Compatibilidad | Su valor real es para tarjetas **impresas**; en pantalla es la más débil de las tres |
| **Código numérico** | Cuando fallan los dos anteriores | Se teclea a mano. **Debe llevar dígito verificador** |

Más el saldo de puntos, el historial de compras, sus apartados y el aviso
de cumpleaños.

### 3.3 El código numérico lleva dígito verificador

No es un detalle menor. Si la cajera teclea mal un número de socio sin
dígito verificador, puede caer **en otro cliente existente** y abonarle
los puntos a quien no era. Con un dígito verificador (algoritmo de Luhn,
como las tarjetas bancarias), la mayoría de los errores de dedo fallan de
inmediato en lugar de acertarle en silencio a la cuenta equivocada.

Formato sugerido: 8 dígitos, el último verificador. Corto para leerse en
voz alta.

### 3.4 La búsqueda por teléfono sigue siendo el piso

Aunque exista la PWA, **la búsqueda por teléfono en el POS no se
elimina**. Es el camino que funciona sin tarjeta, sin app, sin cuenta y
sin batería. Una parte de la clientela no va a instalar nada, y el
teléfono es lo único que todos traen siempre y se saben de memoria.

Con esto no hacen falta tarjetas físicas impresas de entrada. Si más
adelante aparece la demanda, ahí es donde el código de barras 1D se vuelve
útil de verdad.

### 3.5 Requisito: la tarjeta funciona sin sesión

En iPhone, una PWA instalada puede perder su almacenamiento si pasa mucho
tiempo sin abrirse, y una sesión caducada dejaría al cliente sin tarjeta
justo cuando la necesita, formado en la caja.

Por eso: **el número de socio, su QR y su código de barras se guardan en
el dispositivo y se dibujan sin conexión y sin sesión válida.** Volver a
autenticarse sólo hace falta para ver el saldo actualizado y el historial.
La tarjeta nunca deja de funcionar.

### 3.6 Advertencia de hardware

**Un lector láser de una dimensión no lee bien la pantalla de un
teléfono.** Si la tarjeta va a vivir en el celular, el lector Bluetooth
tiene que ser un **imager 2D**, no un láser lineal — y esto aplica tanto
al QR como al código de barras en pantalla. Hay que definirlo antes de
comprar el hardware.

### 3.7 El pase de Wallet, después

Apple Wallet y Google Wallet siguen siendo la experiencia más duradera —
viven en la cartera del teléfono y muestran el saldo sin abrir nada — pero
exigen cuenta de desarrollador, certificados de firma y un servicio de
actualización.

No compiten con la PWA: se **suman** a ella. Una vez que la PWA existe,
agregar un botón "Agregar a Apple Wallet" es incremental, porque el modelo
de datos ya está. Primero la PWA, que hace todo; el pase después, si el
programa agarra tracción.

### 3.8 Fricción de instalación en iPhone

En Android el navegador ofrece instalar la PWA solo. En iPhone hay que
entrar por Safari, Compartir, y "Agregar a pantalla de inicio" — nadie lo
descubre por su cuenta.

Esto no es un problema técnico sino de operación: **la cajera acompaña al
cliente la primera vez.** Conviene tener un instructivo corto en el
mostrador y contemplar el paso dentro del entrenamiento del personal.

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

La regla del contexto maestro (sección 32) se sostiene: **Mi Tienda SM es
dueño del cliente y del saldo de puntos; WooCommerce es un canal.**

- El cliente sigue entrando a la tienda en línea con su cuenta de
  WooCommerce. Mi Tienda SM no necesita ser el login de la web.
- Al llegar un pedido en línea, se empareja al cliente por teléfono o
  correo normalizado. Si no existe, se crea el registro desde los datos
  del pedido.
- Los puntos ganados en línea caen en el **mismo saldo** que los de la
  tienda física, porque el saldo vive en Mi Tienda SM.
- Se guarda `woocommerce_customer_id` para no volver a emparejar por texto
  después.

Todo esto es trabajo posterior al corte, pero el modelo de datos debe
admitirlo desde M7: `phone_e164`, `email`, `auth_user_id` y
`woocommerce_customer_id` existen desde que se crea la tabla, aunque se
llenen mucho más tarde.

## 7. La vista del personal

### 7.1 Búsqueda

Desde el POS y desde administración se busca al cliente por cualquiera de
estos caminos, todos contra el mismo registro:

- **Teléfono** — completo o los últimos cuatro dígitos.
- **Número de socio** — tecleado o escaneado.
- **Nombre** — tolerante a acentos y mayúsculas, igual que la búsqueda de
  productos.
- **Correo.**
- **QR de su tarjeta.**

En el POS la búsqueda tiene que ser de un solo campo: la cajera teclea o
escanea lo que sea y el sistema decide qué es. Obligarla a elegir «buscar
por teléfono» o «buscar por nombre» antes de escribir es un paso de más
en el peor momento posible.

### 7.2 Panel de clientes y cuentas activas

Vista de administración con lo que un dueño quiere saber para juzgar si el
programa sirve:

- Total de clientes registrados.
- **Cuántos tienen cuenta creada**, es decir, cuántos instalaron la PWA y
  entraron de verdad. Recordar que la cuenta es opcional: la mayoría de
  los clientes van a existir sin ella.
- Clientes activos a 30 y 90 días (los que compraron).
- Altas nuevas por semana.
- Cumpleaños del mes.

### 7.3 Permisos y un riesgo que conviene ver de frente

`customers.manage` ya lo tiene el rol `CASHIER`, porque necesita dar de
alta y encontrar clientes para poder venderles. Eso está bien.

Lo que **no** debería tener el mismo permiso es **exportar la lista
completa**. La base de clientes es el activo que más comúnmente se va por
la puerta cuando alguien renuncia. Propuesta:

- Ver y buscar clientes: `customers.manage` (cajera incluida).
- **Exportar en lote: permiso aparte**, sólo administración, y **cada
  exportación queda registrada en la bitácora** con quién, cuándo y
  cuántos registros.

No conviene enmascarar el teléfono en pantalla: la cajera lo necesita
para trabajar, y ocultarlo sólo rompe el flujo sin evitar nada.

### 7.4 Datos personales: decidirlo al inicio sale barato

Un programa de lealtad que guarda nombre, teléfono, correo, fecha de
nacimiento e historial de compras **es tratamiento de datos personales**,
con las obligaciones que eso implica en México. No soy quien deba dar la
opinión legal —conviene que lo revise quien lleve ese tema del cliente—
pero sí hay tres consecuencias de diseño que es mucho más barato resolver
ahora que después:

**1. Consentimiento registrado, no supuesto.**

```sql
customers
  privacy_consent_at       timestamptz
  privacy_notice_version   text
  marketing_consent        boolean not null default false
  marketing_consent_at     timestamptz
```

El consentimiento para el programa de lealtad y el consentimiento para
recibir promociones **son cosas distintas**. Alguien puede querer acumular
puntos y no querer mensajes. Esto se cruza directo con el envío de tickets
por SMS o correo (sección 51.8 del contexto maestro) y con el descuento de
cumpleaños: sin la segunda casilla, mandar promociones es una decisión que
nadie tomó explícitamente.

**2. Aviso de privacidad al registrarse**, tanto en la PWA como en la
captura del POS, con su versión guardada. Si el aviso cambia, se sabe
quién aceptó cuál.

**3. Borrado contra historial: se anonimiza, no se borra.**

Aquí hay un choque real entre dos reglas del proyecto. Si un cliente pide
que eliminen sus datos, la regla 7 del contexto maestro dice que nunca se
borra historial. Ambas se cumplen así:

- Se **anonimiza el registro del cliente**: se vacían nombre, teléfono,
  correo y fecha de nacimiento, y se marca como anonimizado.
- **Las ventas siguen intactas**, apuntando al mismo registro ya anónimo.

Una venta es un registro contable y fiscal; el nombre del comprador es un
dato personal. Se pueden separar, y el modelo debe permitirlo desde que se
crea la tabla: por eso `customers` nunca se borra físicamente y las claves
foráneas desde `sales` jamás se rompen.

**Implementado:** `public.anonymize_customer(customer_id, reason)` exige el
permiso `customers.anonymize` (sólo `ADMIN`) y un motivo, vacía nombre,
teléfono, correo y cumpleaños, y devuelve el `auth_user_id` que quedó
huérfano. **El segundo paso no es opcional:** hay que borrar ese usuario de
Auth, porque ahí sigue guardado el correo con el que entraba. El helper
`lib/customers-admin.ts` hace los dos pasos.

El **número de socio se conserva** a propósito: no es un dato personal y es
lo que mantiene unidas las ventas históricas del registro.

**Y una decisión que parece un descuido y no lo es:** el disparador
`app.audit_customer_change()` registra sólo los *nombres* de los campos que
cambiaron, nunca sus valores, a diferencia del disparador genérico que usan
las demás tablas. Si la bitácora guardara el teléfono o el nombre
anteriores, anonimizar no anonimizaría nada, porque los datos seguirían en
una tabla que por diseño nunca se borra. Está anotado como comentario en la
propia función para que nadie lo "corrija".

## 8. Reglas de negocio todavía pendientes

Nada de esto se implementa hasta tener respuesta (bloquean M7):

1. ¿Cuántos puntos se ganan por peso gastado, y cuánto vale un punto al
   redimir?
2. ¿Los puntos expiran? ¿En cuánto tiempo?
3. ¿Se pueden ganar puntos en mercancía ya rebajada?
4. Si se devuelve una compra, ¿se retiran los puntos que generó?
5. ¿El descuento de cumpleaños es automático o lo autoriza un supervisor?
6. ¿Habrá niveles de cliente, o un solo esquema para todos?
7. **¿Qué se exige para redimir puntos?** El número de socio es copiable
   —basta una foto de la pantalla—, así que conviene distinguir: *acumular*
   puntos en la cuenta de otro es inofensivo, pero *gastarlos* no. Hay que
   definir si redimir exige un segundo dato (por ejemplo los últimos
   cuatro dígitos del teléfono) o autorización de supervisor a partir de
   cierto monto.
8. ¿Quién redacta el aviso de privacidad y qué dice? (sección 7.4)
9. ¿El descuento de cumpleaños y las promociones se mandan sólo a quien
   dio consentimiento de marketing, o el negocio asume que registrarse ya
   lo incluye? Conviene que sea lo primero.

## 9. Estado implementado en 0.9.0

La identidad base y la tarjeta digital ya existen en **Mi Vaquero**. La
PWA está preparada para un host dedicado y, hasta configurar el dominio,
se publica en `/mi`. El acceso por correo no crea cuentas públicas: sólo
acepta clientes previamente registrados y vincula su identidad en el
servidor. SMS se mantiene desactivado hasta configurar proveedor.

El QR, el CODE128 y el número visible codifican exactamente el mismo
`member_number`. Sin conexión se guarda únicamente ese número en un
formato versionado; no se conservan nombre, teléfono, correo, puntos ni
historial. La lectura online se limita a la tarjeta propia mediante
`get_my_customer_card()`. Sigue siendo obligatoria la prueba física con
los lectores reales y no se habilitan puntos o redenciones hasta resolver
las reglas de la sección 8.
