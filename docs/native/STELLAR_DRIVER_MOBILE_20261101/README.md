# Fuentes nativas: turno personal y ubicación del celular

Instantánea revisable de los diez archivos afectados en `C:/Users/Kaleb/Desktop/StellarTracking/flutter_app`; no es un proyecto Flutter completo. Continúa la entrega de acceso por teléfono de `../STELLAR_PHONE_ACCESS_20261031` y requiere sus clientes y pantallas existentes.

`pubspec.yaml` agrega geolocator 14.1.2 y versión Android 1.0.0+3. La configuración local de Android conserva su clave de mapas y no se copia a esta instantánea. El manifiesto existente agrega estos permisos al elemento `manifest`:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

El manifiesto combinado incluye `com.baseflow.geolocator.GeolocatorLocationService` con `foregroundServiceType=location`, comprobado en la APK. El plist de iOS incluye los motivos de ubicación y modo de ubicación en segundo plano; iOS no se ha compilado ni probado en un dispositivo.

La APK Android debug se compila con Flutter 3.47.0. Para esta entrega se ejecutaron 17 pruebas Flutter, análisis de los cuatro archivos principales sin incidencias y compilación debug. El cambio de versión no cambia comportamiento. La ubicación real con el teléfono bloqueado y restricciones del fabricante sigue pendiente de prueba física. Cerrar forzosamente la aplicación puede detener el envío; después de dos minutos sin punto reciente, el servidor excluye el celular.

El servicio comparte puntos solamente durante un turno activo validado por el backend. Salir de sesión detiene la suscripción. Cada turno tiene una versión aleatoria del servidor que impide reutilizar muestras de otro turno. La ubicación del teléfono nunca sustituye un reporte físico vigente que marque ocupado o desconocido.

Ver la [entrega y evidencia](../../STELLAR_DRIVER_MOBILE_20261101.md).
