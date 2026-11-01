import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'driver_shift_state.dart';
import 'taxi_owner_client.dart';
import 'tracking_data_client.dart';

abstract interface class DriverLocationSource {
  Future<void> authorize({required bool ask});
  Stream<Position> positions();
}

class PhoneDriverLocation implements DriverLocationSource {
  @override
  Future<void> authorize({required bool ask}) async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const TaxiOwnerException(
        'Enciende la ubicación del teléfono para compartirla.',
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied && ask) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever ||
        permission == LocationPermission.unableToDetermine) {
      throw const TaxiOwnerException(
        'Permite la ubicación precisa de Stellar en los ajustes del teléfono.',
      );
    }
  }

  @override
  Stream<Position> positions() => Geolocator.getPositionStream(
    locationSettings: Platform.isAndroid
        ? AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            intervalDuration: const Duration(seconds: 15),
            foregroundNotificationConfig: const ForegroundNotificationConfig(
              notificationTitle: 'Stellar · Turno activo',
              notificationText: 'Compartiendo ubicación para recibir viajes. Termina el turno en Stellar para detenerla.',
              enableWakeLock: true,
            ),
          )
        : AppleSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            pauseLocationUpdatesAutomatically: false,
            showBackgroundLocationIndicator: true,
          ),
  );
}

/// Keeps one sender alive across screens. Old sessions and shift versions cannot upload.
class DriverLocationService extends ChangeNotifier {
  static final instance = DriverLocationService();
  final DriverLocationSource source;
  final TaxiOwnerClient Function(String) clientFactory;
  DriverLocationService({
    DriverLocationSource? source,
    TaxiOwnerClient Function(String)? clientFactory,
  }) : source = source ?? PhoneDriverLocation(),
       clientFactory =
           clientFactory ??
           ((session) => TaxiOwnerClient(session: () => session));
  TaxiOwnerClient? _client;
  String? _session;
  StreamSubscription<Position>? _subscription;
  Timer? _freshnessTimer;
  Map<String, Object?>? _pending;
  int _generation = 0, _locationGeneration = 0, _refreshId = 0;
  bool _sending = false, busy = false, sharing = false;
  DriverShiftState? state;
  String? error, locationNotice;
  DateTime? lastSentAt, _lastAttemptAt;
  bool get hasPending => _pending != null;

  Future<void> configure(String? session) async {
    if (_session == session && _client != null) return;
    await reset();
    if (session == null) return;
    _session = session;
    _client = clientFactory(session);
  }

  Future<void> refresh() async {
    final client = _client, generation = _generation, refreshId = ++_refreshId;
    if (client == null || busy) return;
    try {
      final current = DriverShiftState.fromJson(
        await client.call({'action': 'driver_context'}),
      );
      if (generation != _generation || refreshId != _refreshId || busy) return;
      final old = state?.activeUnit;
      state = current;
      error = null;
      final active = current.activeUnit;
      if (old?.id != active?.id ||
          old?.locationVersion != active?.locationVersion) {
        await _stopLocation();
      }
      if (active != null && !sharing) await startLocation(ask: false);
      if (active == null) await _stopLocation();
      notifyListeners();
    } catch (e) {
      if (generation != _generation) return;
      if (e is TaxiOwnerException && [401, 403].contains(e.status)) {
        await _stopLocation();
        state = null;
      }
      error = e is TaxiOwnerException
          ? e.message
          : 'No pudimos consultar tu turno. Actualiza para comprobarlo.';
      notifyListeners();
    }
  }

  Future<void> shift(DriverUnit unit, bool active) async {
    final client = _client, generation = _generation;
    if (busy || client == null) return;
    _refreshId++;
    final command =
        _pending ??
        {
          'action': 'driver_shift',
          'requestId': TrackingDataClient.requestId(),
          'deviceId': unit.id,
          'active': active,
          'expected': unit.version,
        };
    _pending = command;
    busy = true;
    error = null;
    notifyListeners();
    try {
      final result = DriverShiftState.fromJson(await client.call(command));
      if (generation != _generation) return;
      await _stopLocation();
      state = result;
      _pending = null;
      if (result.activeUnit != null) await startLocation(ask: true);
    } catch (e) {
      if (generation != _generation) return;
      error = e is TaxiOwnerException ? e.message : 'No se confirmó el turno. Usa Comprobar cambio para revisar la misma solicitud.';
      if (e is TaxiOwnerException && e.status >= 400 && e.status < 500) {
        _pending = null;
      }
    } finally {
      if (generation == _generation) {
        busy = false;
        notifyListeners();
      }
    }
  }

  Future<void> startLocation({bool ask = true}) async {
    final unit = state?.activeUnit, generation = _generation;
    if (unit == null || _client == null || sharing) return;
    try {
      await source.authorize(ask: ask);
      if (generation != _generation ||
          state?.activeUnit?.locationVersion != unit.locationVersion) {
        return;
      }
      sharing = true;
      locationNotice = 'Buscando tu ubicación…';
      final locationGeneration = ++_locationGeneration;
      _subscription = source.positions().listen(
        (p) => _send(p, unit, generation, locationGeneration),
        onError: (Object _) {
          if (generation == _generation &&
              locationGeneration == _locationGeneration) {
            locationNotice = 'No pudimos obtener ubicación. Revisa el permiso y vuelve a compartirla.';
            sharing = false;
            _subscription?.cancel();
            notifyListeners();
          }
        },
        onDone: () {
          if (generation == _generation &&
              locationGeneration == _locationGeneration) {
            sharing = false;
            locationNotice = 'La ubicación se detuvo. Vuelve a compartirla para recibir viajes sin GPS.';
            notifyListeners();
          }
        },
      );
      _freshnessTimer?.cancel();
      _freshnessTimer = Timer.periodic(const Duration(seconds: 20), (_) {
        if (generation == _generation &&
            sharing &&
            (lastSentAt == null ||
                DateTime.now().difference(lastSentAt!) >
                    const Duration(seconds: 90))) {
          locationNotice = 'Esperando una ubicación reciente. Mientras tanto el celular no cuenta para la búsqueda.';
          notifyListeners();
        }
      });
    } catch (e) {
      if (generation == _generation) {
        locationNotice = e is TaxiOwnerException
            ? e.message
            : 'No pudimos iniciar la ubicación del teléfono.';
      }
    }
    if (generation == _generation) notifyListeners();
  }

  Future<void> _send(
    Position p,
    DriverUnit unit,
    int generation,
    int locationGeneration,
  ) async {
    if (_sending ||
        generation != _generation ||
        locationGeneration != _locationGeneration ||
        !sharing ||
        _client == null ||
        unit.locationVersion != state?.activeUnit?.locationVersion) {
      return;
    }
    final now = DateTime.now(), age = DateTime.now().difference(p.timestamp);
    if (p.isMocked ||
        !p.accuracy.isFinite ||
        p.accuracy < 0 ||
        p.accuracy > 100 ||
        age > const Duration(seconds: 90) ||
        age < const Duration(seconds: -30)) {
      locationNotice = 'Esperando una ubicación precisa y reciente.';
      notifyListeners();
      return;
    }
    if (_lastAttemptAt != null &&
        now.difference(_lastAttemptAt!) < const Duration(seconds: 15)) {
      return;
    }
    _lastAttemptAt = now;
    _sending = true;
    try {
      final result = await _client!.call({
        'action': 'driver_position',
        'deviceId': unit.id,
        'version': unit.locationVersion,
        'lat': p.latitude,
        'lng': p.longitude,
        'accuracy': p.accuracy,
        'speed': p.speed.isFinite && p.speed >= 0 ? p.speed : 0,
        'heading': p.heading.isFinite && p.heading >= 0 && p.heading < 360
            ? p.heading
            : null,
        'recordedAt': p.timestamp.toUtc().toIso8601String(),
        'mocked': p.isMocked,
      });
      if (generation != _generation ||
          locationGeneration != _locationGeneration) {
        return;
      }
      if (result['state'] == 'saved') {
        lastSentAt = now;
        locationNotice = 'Ubicación del teléfono al día. El sistema dará preferencia a las unidades con GPS.';
      }
    } catch (e) {
      if (generation != _generation ||
          locationGeneration != _locationGeneration) {
        return;
      }
      locationNotice = e is TaxiOwnerException ? e.message : 'Sin conexión para enviar ubicación. Se comprobará con el siguiente punto.';
      if (e is TaxiOwnerException && [401, 403, 409].contains(e.status)) {
        await _stopLocation();
        if (generation == _generation) notifyListeners();
      }
    } finally {
      if (generation == _generation &&
          locationGeneration == _locationGeneration) {
        _sending = false;
        notifyListeners();
      }
    }
  }

  Future<void> _stopLocation() async {
    _locationGeneration++;
    _sending = false;
    _lastAttemptAt = null;
    sharing = false;
    _freshnessTimer?.cancel();
    _freshnessTimer = null;
    final subscription = _subscription;
    _subscription = null;
    await subscription?.cancel();
    lastSentAt = null;
  }

  Future<void> reset() async {
    _generation++;
    await _stopLocation();
    _client?.close();
    _client = null;
    _session = null;
    state = null;
    error = null;
    locationNotice = null;
    _pending = null;
    busy = false;
    _sending = false;
    notifyListeners();
  }
}
