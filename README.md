# Archivo IT — despliegue con Portainer

Aplicación web privada para subir documentos y buscar dentro de TXT, Word (.docx), Excel (.xlsx/.xlsm) y PDF. Los archivos se almacenan en el volumen persistente `archivo_it_data`, separado del código. El archivo KeePass se guarda como archivo y no se descifra ni se indexa.

## Contenido del paquete

- `server.js`, `public/`, `package.json`: aplicación.
- `Dockerfile`, `compose.yaml`: imagen y Stack de Portainer.
- El repositorio **no debe contener** tus archivos de datos. `.gitignore` excluye documentos sensibles y archivos de datos comunes.

## Despliegue recomendado

1. Creá un repositorio **privado** en GitHub y subí solamente el contenido de esta carpeta. Revisá antes que no haya documentos reales, `.env` ni credenciales.
2. En Portainer, creá un Stack desde ese repositorio y elegí `compose.yaml`.
3. En las variables del Stack definí:
   - `APP_USER`: tu usuario.
   - `APP_PASSWORD`: una contraseña aleatoria larga (mínimo 14 caracteres).
   - `SESSION_SECRET`: cadena aleatoria de al menos 32 caracteres.
   - `APP_PORT`: puerto local del servidor, por ejemplo `8090` (opcional).
   - `COOKIE_SECURE=1`: recomendado y predeterminado para HTTPS.
4. Desplegá el Stack. El volumen `archivo_it_data` se crea automáticamente y sobrevive a recreaciones del contenedor.
5. El puerto queda ligado a `127.0.0.1` en el host, accesible desde un proxy inverso instalado en ese servidor. Configurá el proxy para reenviar a `127.0.0.1:8090` y usá HTTPS. Para que un proxy inverso en otro contenedor acceda, conectalo a la misma red Docker del Stack y ajustá el enlace del puerto según tu configuración. Para conectarte desde fuera de tu red, accedé por VPN. No publiques el puerto de la aplicación directamente en internet.
6. En la web, iniciá sesión y cargá archivos o una carpeta completa. Al subir una carpeta, la aplicación sugiere categorías usando nombres y subcarpetas; también podés elegir una categoría manualmente. Cada archivo puede pesar hasta 100 MB.

El selector de carpeta permite importar el contenido actual de `PLANILLAS IT - CREDENCIALES` desde tu PC. Los archivos se copian al servidor; los originales permanecen en su ubicación. Tipos no indexables como `.rar` también se conservan, y `.kdbx` nunca se descifra.

## Generar secretos en PowerShell

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Usá una salida para `SESSION_SECRET`; creá una contraseña distinta para `APP_PASSWORD`. Guardalas en el gestor de contraseñas, no en GitHub.

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
