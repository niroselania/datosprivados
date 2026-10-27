# Archivo IT — despliegue con Portainer

Aplicación web privada para subir documentos, buscar dentro de TXT, Word (.docx), Excel (.xlsx/.xlsm) y PDF, y abrir una vista previa desde la biblioteca. PDF se muestra en el navegador; texto, Word y Excel se presentan como texto extraído. También permite eliminar archivos con confirmación y editar archivos de texto, CSV/TSV y planillas XLSX (edición básica de celdas; conviene conservar una copia para archivos con formatos complejos). Word, PDF, KeePass, ZIP y RAR se descargan para editarlos con su aplicación correspondiente. Los archivos se almacenan en el volumen persistente `archivo_it_data`, separado del código. El archivo KeePass se guarda como archivo y no se descifra ni se indexa.

## Contenido del paquete

- `server.js`, `public/`, `package.json`: aplicación.
- `Dockerfile`, `docker-compose.yml`: imagen y Stack de Portainer.
- El repositorio **no debe contener** tus archivos de datos. `.gitignore` excluye documentos sensibles y archivos de datos comunes.

## Despliegue recomendado

1. Descomprimí el ZIP y subí el contenido de la carpeta al repositorio **privado** de GitHub; no subas solo el ZIP. En la raíz del repositorio deben quedar `docker-compose.yml`, `Dockerfile`, `server.js`, `package.json` y la carpeta `public`. Revisá que no haya documentos reales, `.env` ni credenciales.
2. En Portainer, creá un Stack desde ese repositorio y elegí la misma rama donde están esos archivos. Si están directamente en la raíz, el Compose path es `docker-compose.yml`. Si subiste la carpeta contenedora completa, usá `Archivo IT Portainer corregido/docker-compose.yml` como ruta. Portainer clona el repositorio y resuelve el Compose path desde su raíz.
3. En el apartado **Environment variables** del Stack definí:
   - `APP_USER`: tu usuario.
   - `APP_PASSWORD`: una contraseña aleatoria larga (mínimo 14 caracteres).
   - `SESSION_SECRET`: cadena aleatoria de al menos 32 caracteres.
   - `TELEGRAM_BOT_TOKEN`: token del bot que entrega BotFather. Es opcional; cargalo solo como variable del Stack en Portainer, nunca en GitHub.
   - `TELEGRAM_ALLOWED_USERS`: IDs numéricos de Telegram autorizados, separados por coma. Es obligatorio para consultar datos desde el bot.
   El Compose toma estos valores directamente del formulario del Stack. Si falta alguno, el contenedor mostrará un error de configuración en sus logs.
4. Desplegá el Stack. El volumen `archivo_it_data` se crea automáticamente y sobrevive a recreaciones del contenedor.
5. El puerto se publica como `${APP_PORT:-9090}` para acceder desde otras PCs de la red local usando `http://IP-DEL-SERVIDOR:9090`. El valor predeterminado `COOKIE_SECURE=0` permite iniciar sesión por HTTP durante pruebas en una red confiable. Para usar un proxy inverso con HTTPS, configurá `COOKIE_SECURE=1` y reenviá al puerto del servidor. No expongas el puerto directamente a Internet; para acceso remoto usá HTTPS y VPN.
6. En la web, iniciá sesión y cargá archivos o una carpeta completa. La biblioteca aparece primero y el índice de búsqueda se completa en segundo plano. Al subir una carpeta, la aplicación sugiere categorías usando nombres y subcarpetas; también podés elegir una categoría manualmente. Cada archivo puede pesar hasta 100 MB.

## Bot de Telegram (opcional)

1. En Portainer, agregá `TELEGRAM_BOT_TOKEN` con el token de BotFather y dejá `TELEGRAM_ALLOWED_USERS` vacío por ahora. Redeplegá el Stack.
2. Abrí un chat privado con tu bot y enviá `/id`. El bot responde únicamente con tu ID numérico; no muestra datos hasta autorizarlo.
3. En Portainer, agregá ese ID en `TELEGRAM_ALLOWED_USERS` y redeplegá. Para más usuarios, separá los IDs con comas. No compartas el token ni lo subas al repositorio.
4. En el chat privado, escribí `backup` o `/buscar backup`. El bot lista hasta 10 coincidencias por nombre o contenido. Respondé con el número para recibir el texto extraído. Para agregar información, enviá `/agregar` para elegir entre los primeros 10 archivos, o `/agregar backup` para buscar archivos por nombre. Elegí uno, mandá el texto, revisá la vista previa y confirmá con `/confirmar`; `/cancelar` descarta la operación. Las opciones y confirmaciones vencen a los 10 minutos.

El bot solo atiende chats privados y solo IDs autorizados. Admite el contenido indexable (texto, CSV, Word DOCX, Excel y PDF con texto). No descifra KeePass ni lee ZIP/RAR o Word DOC antiguo. Para esos formatos, indica usar la web. La función de agregar añade al final únicamente de TXT, MD, CSV, TSV y LOG; otros formatos se protegen para evitar corromperlos.

El bot usa consultas salientes (long polling) a Telegram desde el contenedor; el servidor necesita acceso a Internet. Si el token ya tiene un webhook configurado o un segundo proceso está usando long polling, el bot no puede recibir actualizaciones simultáneamente: usá un bot dedicado o desactivá el otro método antes de habilitarlo. La aplicación no elimina webhooks automáticamente.

El selector de carpeta permite importar el contenido actual de `PLANILLAS IT - CREDENCIALES` desde tu PC. Los archivos se copian al servidor; los originales permanecen en su ubicación. Tipos no indexables como `.rar` también se conservan, y `.kdbx` nunca se descifra.

## Generar secretos en PowerShell

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Usá una salida para `SESSION_SECRET`; creá una contraseña distinta para `APP_PASSWORD`. Guardalas en el gestor de contraseñas, no en GitHub.

No subas archivos `.env`, `stack.env` ni credenciales al repositorio. `.gitignore` excluye formatos de credenciales, documentos y datos habituales; verificá los archivos del repositorio antes de hacerlo público.

## Datos y límites

- El volumen Docker contiene los documentos cargados y debe incluirse en tu estrategia de copias de seguridad cifradas.
- El índice se reconstruye al consultar; no se guarda una copia de texto en otra base de datos.
- Los archivos de sesión se guardan en el volumen protegido y no aparecen en la biblioteca.
- El sistema permite búsquedas en PDF con texto seleccionable; los PDF escaneados no se reconocen por OCR.
- `.kdbx` se conserva y descarga, pero la aplicación no lo abre ni busca dentro de él.
- La autenticación usa un usuario y contraseña compartidos configurados como variables del Stack. La sesión dura hasta 8 horas.
- Los documentos del volumen no se cifran individualmente por la aplicación. Protegé el disco y los respaldos del servidor.
- Las sesiones duran hasta 8 horas. Cambiar el secreto de sesión las invalida.

## Copias de seguridad

Respaldá el volumen `archivo_it_data` desde el host o con la solución de backup de Docker que uses. Probá la restauración y guardá el backup cifrado. No agregues el contenido del volumen al repositorio.






