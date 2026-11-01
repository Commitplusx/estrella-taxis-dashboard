import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_app/services/driver_location_service.dart';
import 'package:flutter_app/services/taxi_owner_client.dart';

class LocationSource implements DriverLocationSource {
  final points = StreamController<Position>.broadcast();
  bool denied = false;
  @override
  Future<void> authorize({required bool ask}) async {
    if (denied) throw const TaxiOwnerException('Permite ubicación.');
  }

  @override
  Stream<Position> positions() => points.stream;
}

Map<String, Object?> context({bool active = false}) => {
  'contact': {
    'id': '33333333-3333-4333-8333-333333333333',
    'name': 'Chofer sintético',
    'role': 'driver',
    'unitNumber': '509',
    'version': 'a' * 32,
    'phone': '+529630000081',
    'accountUserId': 81,
    'receiving': active,
  },
  'units': [
    {
      'deviceId': 1,
      'name': 'Unidad 509',
      'active': active,
      'busy': false,
      'occupiedByOther': false,
      'version': 'b' * 32,
      'locationVersion': active ? 'c' * 32 : null,
      'mobileFresh': false,
    },
  ],
};
Position point({bool mocked = false, DateTime? time}) => Position(
  longitude: -92.13,
  latitude: 16.25,
  timestamp: time ?? DateTime.now(),
  accuracy: 10,
  altitude: 0,
  altitudeAccuracy: 0,
  heading: 0,
  headingAccuracy: 0,
  speed: 0,
  speedAccuracy: 0,
  isMocked: mocked,
);
Future<void> settle() async {
  await Future<void>.delayed(const Duration(milliseconds: 20));
}

void main() {
  test(
    'a revoked shift stops location immediately and notifies the screen',
    () async {
      final source = LocationSource();
      final service = DriverLocationService(
        source: source,
        clientFactory: (session) => TaxiOwnerClient(
          session: () => session,
          client: MockClient((request) async {
            final raw = jsonDecode(request.body) as Map<String, Object?>;
            return raw['action'] == 'driver_position'
                ? http.Response(jsonEncode({'error': 'El turno cambió.'}), 409)
                : http.Response(jsonEncode(context(active: true)), 200);
          }),
        ),
      );
      var notifications = 0;
      service.addListener(() => notifications++);
      await service.configure('JSESSIONID=fixture-session');
      await service.refresh();
      final before = notifications;
      source.points.add(point());
      await settle();
      expect(service.sharing, false);
      expect(notifications, greaterThan(before));
      await service.reset();
      await source.points.close();
      service.dispose();
    },
  );
  test('an active shift sends a real fix using its location epoch; logout stops all sending', () async {
    final source = LocationSource(), requests = <Map<String, Object?>>[];
    final service = DriverLocationService(
      source: source,
      clientFactory: (session) => TaxiOwnerClient(
        session: () => session,
        client: MockClient((request) async {
          final body = jsonDecode(request.body) as Map<String, Object?>;
          requests.add(body);
          return http.Response(
            jsonEncode(
              body['action'] == 'driver_context'
                  ? context(active: true)
                  : {'state': 'saved'},
            ),
            200,
          );
        }),
      ),
    );
    await service.configure('JSESSIONID=fixture-session');
    await service.refresh();
    expect(service.sharing, true);
    source.points.add(point());
    await settle();
    final send = requests.where((r) => r['action'] == 'driver_position').single;
    expect(send['version'], 'c' * 32);
    expect(send['deviceId'], 1);
    expect(send.containsKey('userId'), false);
    await service.reset();
    source.points.add(point());
    await settle();
    expect(requests.where((r) => r['action'] == 'driver_position').length, 1);
    await source.points.close();
    service.dispose();
  });
  test('mocked and old fixes never go to the server', () async {
    final source = LocationSource(), actions = <String>[];
    final service = DriverLocationService(
      source: source,
      clientFactory: (session) => TaxiOwnerClient(
        session: () => session,
        client: MockClient((request) async {
          final raw = jsonDecode(request.body) as Map<String, Object?>;
          actions.add(raw['action'] as String);
          return http.Response(jsonEncode(context(active: true)), 200);
        }),
      ),
    );
    await service.configure('JSESSIONID=fixture-session');
    await service.refresh();
    source.points.add(point(mocked: true));
    source.points.add(
      point(time: DateTime.now().subtract(const Duration(minutes: 3))),
    );
    await settle();
    expect(actions, ['driver_context']);
    await service.reset();
    await source.points.close();
    service.dispose();
  });
  test('an uncertain shift retries its same request ID; denied GPS remains visible without claiming that sharing started', () async {
    final source = LocationSource()..denied = true,
        shifts = <Map<String, Object?>>[];
    final service = DriverLocationService(
      source: source,
      clientFactory: (session) => TaxiOwnerClient(
        session: () => session,
        client: MockClient((request) async {
          final body = jsonDecode(request.body) as Map<String, Object?>;
          if (body['action'] == 'driver_shift') {
            shifts.add(body);
            if (shifts.length == 1) throw http.ClientException('Response lost');
            return http.Response(jsonEncode(context(active: true)), 200);
          }
          return http.Response(jsonEncode(context()), 200);
        }),
      ),
    );
    await service.configure('JSESSIONID=fixture-session');
    await service.refresh();
    final unit = service.state!.units.single;
    await service.shift(unit, true);
    expect(service.hasPending, true);
    await service.shift(unit, true);
    expect(shifts[0]['requestId'], shifts[1]['requestId']);
    expect(service.hasPending, false);
    expect(service.state!.activeUnit, isNotNull);
    expect(service.sharing, false);
    expect(service.locationNotice, contains('Permite'));
    await service.reset();
    await source.points.close();
    service.dispose();
  });
}
