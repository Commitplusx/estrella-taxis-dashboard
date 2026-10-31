import 'dart:convert';

import 'package:http/http.dart' as http;

class TaxiOwnerException implements Exception {
  final String message;
  final int status;
  const TaxiOwnerException(this.message, {this.status = 0});
  @override
  String toString() => message;
}

Map<String, Object?> ownerRecord(Object? value) {
  if (value is Map<String, Object?>) return value;
  throw const TaxiOwnerException('No pudimos validar los datos de tu taxi.');
}

String ownerText(Object? value, [int max = 120]) {
  if (value is String && value.isNotEmpty && value.length <= max) return value;
  throw const TaxiOwnerException('Los datos del chofer están incompletos.');
}

String ownerId(Object? value) {
  final id = ownerText(value, 36);
  if (!RegExp(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$').hasMatch(id)) {
    throw const TaxiOwnerException(
      'El contacto no tiene un identificador válido.',
    );
  }
  return id;
}

class TaxiPerson {
  final String id, name, role, unitNumber, version;
  final String? phone;
  final int? accountId;
  final bool receiving;
  TaxiPerson.fromJson(Object? value)
    : id = ownerId(ownerRecord(value)['id']),
      name = ownerText(ownerRecord(value)['name']),
      role = ownerText(ownerRecord(value)['role'], 20),
      unitNumber = ownerText(ownerRecord(value)['unitNumber'], 20),
      version = ownerText(ownerRecord(value)['version'], 32),
      phone = ownerRecord(value)['phone'] is String
          ? ownerRecord(value)['phone'] as String
          : null,
      accountId = ownerRecord(value)['accountUserId'] is int
          ? ownerRecord(value)['accountUserId'] as int
          : null,
      receiving = ownerRecord(value)['receiving'] == true;
}

class TaxiSignup {
  final String requestId, contactId, name, phone;
  final String? expected, email;
  final bool review;
  TaxiSignup.fromJson(Object? value)
    : requestId = ownerId(ownerRecord(value)['requestId']),
      contactId = ownerId(ownerRecord(value)['contactId']),
      name = ownerText(ownerRecord(value)['name']),
      phone = ownerText(ownerRecord(value)['phone'], 40),
      expected = ownerRecord(value)['expected'] is String
          ? ownerRecord(value)['expected'] as String
          : null,
      email = ownerRecord(value)['email'] is String
          ? ownerRecord(value)['email'] as String
          : null,
      review = ownerRecord(value)['review'] == true;
}

class TaxiOwnerState {
  final TaxiPerson owner;
  final int deviceId;
  final List<TaxiPerson> drivers;
  final List<TaxiSignup> pending;
  final String? driverName, driverPhone, driverVersion;
  final bool active, busy;
  TaxiOwnerState.fromJson(Map<String, Object?> value)
    : owner = TaxiPerson.fromJson(value['owner']),
      deviceId = value['deviceId'] is int ? value['deviceId'] as int : 0,
      drivers = _people(value['drivers']),
      pending = _signups(value['pending']),
      driverName = value['driver'] == null
          ? null
          : ownerText(ownerRecord(value['driver'])['name']),
      driverPhone = value['driver'] == null
          ? null
          : ownerText(ownerRecord(value['driver'])['phone'], 16),
      driverVersion = value['driver'] == null
          ? null
          : ownerText(ownerRecord(value['driver'])['version'], 32),
      active =
          value['driver'] != null &&
          ownerRecord(value['driver'])['active'] == true,
      busy = value['busy'] == true {
    if (deviceId < 1 ||
        !['owner', 'owner_driver'].contains(owner.role) ||
        value['busy'] is! bool ||
        drivers.map((d) => d.id).toSet().length != drivers.length) {
      throw const TaxiOwnerException(
        'El acceso no corresponde al dueño de este taxi.',
      );
    }
  }
  static List<TaxiPerson> _people(Object? value) {
    if (value is! List<Object?> || value.length > 20) {
      throw const TaxiOwnerException('La lista de choferes no es válida.');
    }
    return value.map(TaxiPerson.fromJson).toList();
  }

  static List<TaxiSignup> _signups(Object? value) {
    if (value is! List<Object?> || value.length > 20) {
      throw const TaxiOwnerException('Las altas pendientes no son válidas.');
    }
    return value.map(TaxiSignup.fromJson).toList();
  }
}

class TaxiOwnerClient {
  static const projectUrl = 'https://izrsxygazsalfhpaualj.supabase.co';
  final String? Function() session;
  final http.Client client;
  TaxiOwnerClient({required this.session, http.Client? client})
    : client = client ?? http.Client();
  Future<Map<String, Object?>> call(Map<String, Object?> body) async {
    final cookie = session();
    if (cookie == null ||
        !RegExp(r'^JSESSIONID=[A-Za-z0-9._~-]{8,512}$').hasMatch(cookie)) {
      throw const TaxiOwnerException(
        'Inicia sesión otra vez con tu número y contraseña.',
      );
    }
    final response = await client
        .post(
          Uri.parse('$projectUrl/functions/v1/taxi-bot-admin'),
          headers: {
            'Content-Type': 'application/json',
            'x-traccar-session': cookie,
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 90));
    if (response.bodyBytes.length > 262144) {
      throw const TaxiOwnerException(
        'La respuesta excede el límite de esta consulta.',
      );
    }
    final Object? raw;
    try {
      raw = jsonDecode(response.body);
    } on FormatException {
      throw const TaxiOwnerException(
        'No pudimos validar la respuesta del servidor. Comprueba el mismo cambio.',
      );
    }
    final result = ownerRecord(raw);
    if (response.statusCode != 200) {
      throw TaxiOwnerException(
        result['error'] is String
            ? result['error'] as String
            : 'No se confirmó el cambio.',
        status: response.statusCode,
      );
    }
    return result;
  }

  Future<TaxiPerson> self() async =>
      TaxiPerson.fromJson((await call({'action': 'account_self'}))['contact']);
  Future<TaxiOwnerState> read() async =>
      TaxiOwnerState.fromJson(await call({'action': 'owner_context'}));
  Future<TaxiOwnerState> save(Map<String, Object?> command) async =>
      TaxiOwnerState.fromJson(await call(command));
  void close() => client.close();
}
