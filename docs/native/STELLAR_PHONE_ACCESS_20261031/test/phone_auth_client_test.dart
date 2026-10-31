import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../lib/services/phone_auth_client.dart';

void main() {
  test('phone login uses the public phone action and returns only a validated user session', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/functions/v1/taxi-bot-admin');
      expect(jsonDecode(request.body), {
        'action': 'phone_login',
        'phone': '9630000021',
        'password': 'Fixture-password-123',
        'client': 'apk',
      });
      expect(request.headers.containsKey('x-traccar-session'), false);
      return http.Response(
        jsonEncode({'session': 'JSESSIONID=personal-session'}),
        200,
      );
    });
    expect(
      await phoneSession('9630000021', 'Fixture-password-123', client: client),
      'JSESSIONID=personal-session',
    );
    client.close();
  });
  for (final response in [
    http.Response('{"error":"Número o contraseña incorrectos."}', 401),
    http.Response('{"error":"Espera diez minutos."}', 429),
    http.Response('{"session":"JSESSIONID=bad; injected=true"}', 200),
    http.Response('{"token":"web-only-token"}', 200),
    http.Response('x' * 8193, 200),
  ]) {
    test(
      'phone login refuses invalid session or server error ${response.statusCode}/${response.body.length}',
      () async {
        final client = MockClient((_) async => response);
        await expectLater(
          phoneSession('9630000021', 'Fixture-password-123', client: client),
          throwsA(isA<PhoneAuthException>()),
        );
        client.close();
      },
    );
  }
}
