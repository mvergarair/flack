# Instala Flack en tu proyecto de Firebase

<walkthrough-tutorial-duration duration="15"></walkthrough-tutorial-duration>

Flack es un chat de equipo que funciona completamente en **tu propio** proyecto de Firebase.
Esta guía crea un proyecto (o usa uno existente), activa los servicios que necesita y despliega
la app.

**Costos.** Flack necesita el plan **Blaze** de Firebase, que es de pago por uso: solo pagas lo
que supere las cuotas gratuitas. Un equipo de 10 a 100 personas normalmente se mantiene en
**$0 al mes** o muy cerca. El instalador crea una alerta de presupuesto (US$5 al mes por
defecto) para avisarte mucho antes de cualquier sorpresa. Necesitas una cuenta de facturación;
Google puede ofrecer crédito de prueba al crearla.

Haz clic en **Start** para comenzar.

## Usa Node.js 22

Las herramientas de Flack necesitan Node.js 22. Cloud Shell tiene `nvm`, así que toma unos
segundos:

```sh
nvm install 22 && nvm use 22
```

## Corre el instalador

```sh
npm run setup
```

Te pregunta cuatro cosas (en inglés):

1. **Un id de proyecto.** Acepta la sugerencia para crear uno nuevo, o escribe uno existente.
2. **Una región.** `us-central1` está bien por defecto; `europe-west1` para Europa.
3. **El email de tu cuenta de Google.** Esa cuenta será el primer admin.
4. **Una alerta de presupuesto mensual** en dólares.

Luego vincula la facturación (tú eliges la cuenta), activa los servicios, escribe la
configuración y despliega. El primer despliegue toma de 5 a 10 minutos.

## Activa el inicio de sesión con Google

Es el único paso que Google no permite automatizar. El instalador muestra un enlace así:

`https://console.firebase.google.com/project/<tu-proyecto>/authentication/providers`

Ábrelo, elige **Add new provider → Google → Enable**, selecciona un email de soporte y
haz clic en **Save**.

## Inicia sesión

Abre `https://<tu-proyecto>.web.app` e inicia sesión con el email que le diste al instalador.
Eres el admin: ve a **Admin → Invite people** para sumar a tu equipo.

En el teléfono, usa **Agregar a inicio** (iPhone) o **Instalar app** (Android) para recibir
notificaciones como en una app nativa.

## Listo

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

Para actualizar, abre Cloud Shell y corre `cd flack && npm run update`. Tu configuración se
mantiene, y los admins ven un aviso en la app cuando hay una versión nueva.
