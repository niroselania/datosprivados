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
   El Compose toma estos valores directamente del formulario del Stack. Si falta alguno, el contenedor mostrará un error de configuración en sus logs.
4. Desplegá el Stack. El volumen `archivo_it_data` se crea automáticamente y sobrevive a recreaciones del contenedor.
5. El puerto se publica como `${APP_PORT:-9090}` para acceder desde otras PCs de la red local usando `http://IP-DEL-SERVIDOR:9090`. El valor predeterminado `COOKIE_SECURE=0` permite iniciar sesión por HTTP durante pruebas en una red confiable. Para usar un proxy inverso con HTTPS, configurá `COOKIE_SECURE=1` y reenviá al puerto del servidor. No expongas el puerto directamente a Internet; para acceso remoto usá HTTPS y VPN.
6. En la web, iniciá sesión y cargá archivos o una carpeta completa. La biblioteca aparece primero y el índice de búsqueda se completa en segundo plano. Al subir una carpeta, la aplicación sugiere categorías usando nombres y subcarpetas; también podés elegir una categoría manualmente. Cada archivo puede pesar hasta 100 MB.

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






