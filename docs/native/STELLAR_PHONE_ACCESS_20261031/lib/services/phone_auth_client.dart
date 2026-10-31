import 'dart:convert';

import 'package:http/http.dart' as http;

class PhoneAuthException implements Exception {
  final String message;
  const PhoneAuthException(this.message);
}

Future<String> phoneSession(
  String phone,
  String password, {
  http.Client? client,
}) async {
  final httpClient = client ?? http.Client();
  try {
    final response = await httpClient
        .post(
          Uri.parse(
            'https://izrsxygazsalfhpaualj.supabase.co/functions/v1/taxi-bot-admin',
          ),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'action': 'phone_login',
            'phone': phone,
            'password': password,
            'client': 'apk',
          }),
        )
        .timeout(const Duration(seconds: 50));
    if (response.bodyBytes.length > 8192)
      throw const PhoneAuthException('No pudimos validar la sesión.');
    final Object? value = jsonDecode(response.body);
    if (value is! Map<String, Object?>)
      throw const PhoneAuthException('No pudimos validar la sesión.');
    if (response.statusCode != 200) {
      throw PhoneAuthException(
        value['error'] is String
            ? value['error'] as String
            : 'No pudimos iniciar sesión.',
      );
    }
    final cookie = value['session'];
    if (cookie is! String ||
        !RegExp(r'^JSESSIONID=[A-Za-z0-9._~-]{8,512}$').hasMatch(cookie))
      throw const PhoneAuthException('No pudimos validar la sesión.');
    return cookie;
  } finally {
    if (client == null) httpClient.close();
  }
}
