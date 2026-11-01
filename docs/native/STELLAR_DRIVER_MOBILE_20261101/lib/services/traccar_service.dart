import 'dart:convert';
import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/io.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'taxi_app_access.dart';
import 'phone_auth_client.dart';
import 'driver_location_service.dart';

class TraccarService {
  static const String baseUrl = 'https://taxis.estrella-eats.mx/api';
  static const String wsUrl = 'wss://taxis.estrella-eats.mx/api/socket';

  String? _cookie;
  // Read-only session handle for authenticated tracking queries. Never persisted in another service.
  String? get trackingSession => _cookie;
  TaxiAppAccess? taxiAccess;
  String? loginError;
  IOWebSocketChannel? _channel;
  bool _isConnecting = false;

  // Stream to broadcast WebSocket messages
  final StreamController<Map<String, dynamic>> _wsController =
      StreamController.broadcast();
  Stream<Map<String, dynamic>> get wsStream => _wsController.stream;

  // Singleton pattern
  static final TraccarService _instance = TraccarService._internal();
  factory TraccarService() => _instance;
  TraccarService._internal();

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _cookie = prefs.getString('traccar_cookie');

    // Verificar si la cookie aún es válida en el servidor
    bool valid = await isLoggedIn;

    if (!valid) {
      // Si caducó, intentamos un inicio de sesión silencioso con las credenciales guardadas
      final email = prefs.getString('saved_email');
      final pass = prefs.getString('saved_password');
      if (email != null && pass != null) {
        final relogged = await login(email, pass);
        if (relogged) {
          // Reconectar WebSocket usando la nueva cookie de sesión
          disconnectWebSocket();
          await connectWebSocket();
        }
      }
    } else {
      if (_cookie != null) {
        // Intentar registrar el token de Firebase en cada inicio
        registerFirebaseToken();
        // Asegurar que las notificaciones de encendido/apagado estén activas
        ensureIgnitionNotifications();
      }
    }
  }

  Future<bool> get isLoggedIn async {
    if (_cookie == null) return false;
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/session'),
        headers: {'Cookie': _cookie!},
      );
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  Future<bool> login(String email, String password) async {
    taxiAccess = null;
    loginError = null;
    try {
      final identifier = email.trim();
      if (!identifier.contains('@')) {
        final cookie = await phoneSession(identifier, password);
        _cookie = cookie;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('traccar_cookie', cookie);
        await prefs.remove('saved_email');
        await prefs.remove('saved_password');
        await registerFirebaseToken();
        return true;
      }
      final response = await http.post(
        Uri.parse('$baseUrl/session'),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {'email': identifier, 'password': password},
      );

      if (response.statusCode == 200) {
        final rawCookie = response.headers['set-cookie'];
        if (rawCookie != null) {
          int index = rawCookie.indexOf(';');
          _cookie = (index == -1) ? rawCookie : rawCookie.substring(0, index);

          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('traccar_cookie', _cookie!);
          await prefs.setString('saved_email', email);
          await prefs.setString('saved_password', password);

          // Registrar token de notificaciones push
          await registerFirebaseToken();

          return true;
        }
      }
      return false;
    } catch (e) {
      loginError = e is PhoneAuthException
          ? e.message
          : 'No pudimos conectar. Intenta de nuevo.';
      return false;
    }
  }

  Future<bool> resetPassword(String email) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/password/reset'),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: {'email': email},
      );
      // Depending on Traccar version and config, it might return 200, 202, or 204
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (e) {
      print('Password reset error: $e');
      return false;
    }
  }

  Future<void> logout() async {
    await DriverLocationService.instance.reset();
    try {
      disconnectWebSocket();
      if (_cookie != null) {
        await http.delete(
          Uri.parse('$baseUrl/session'),
          headers: {'Cookie': _cookie!},
        );
      }
    } finally {
      taxiAccess = null;
      _cookie = null;
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('traccar_cookie');
      await prefs.remove('saved_email');
      await prefs.remove('saved_password');
    }
  }

  Future<void> registerFirebaseToken() async {
    if (_cookie == null) return;
    try {
      final fcmToken = await FirebaseMessaging.instance.getToken();
      if (fcmToken == null) return;

      // 1. Obtener la sesión actual para saber el ID del usuario
      final sessionResp = await http.get(
        Uri.parse('$baseUrl/session'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );

      if (sessionResp.statusCode == 200) {
        final user = json.decode(sessionResp.body);
        final userId = user['id'];

        // 2. Modificar los atributos para agregar el token
        Map<String, dynamic> attributes = user['attributes'] ?? {};
        String currentTokens = attributes['notificationTokens'] ?? '';

        // Si el token ya está registrado, no hacemos nada
        if (currentTokens.contains(fcmToken)) return;

        // Agregar el token separado por coma si ya hay otros
        if (currentTokens.isNotEmpty) {
          attributes['notificationTokens'] = '$currentTokens,$fcmToken';
        } else {
          attributes['notificationTokens'] = fcmToken;
        }
        user['attributes'] = attributes;

        // 3. Actualizar el usuario en Traccar
        final putResp = await http.put(
          Uri.parse('$baseUrl/users/$userId'),
          headers: {
            'Cookie': _cookie!,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: json.encode(user),
        );

        if (putResp.statusCode == 200) {
          print("Firebase token successfully registered in Traccar!");
        } else {
          print(
            "ERROR registering token in Traccar: ${putResp.statusCode} - ${putResp.body}",
          );
        }
      }
    } catch (e) {
      print("Error registering Firebase token: $e");
    }
  }

  Future<void> connectWebSocket() async {
    if (_cookie == null) return;
    if (_channel != null) return; // Ya está conectado
    if (_isConnecting) return;

    _isConnecting = true;
    try {
      _channel = IOWebSocketChannel.connect(
        Uri.parse(wsUrl),
        headers: {'Cookie': _cookie!},
      );

      // Esperar a que conecte para atrapar errores de DNS/Red (como Failed host lookup)
      await _channel!.ready;

      _channel!.stream.listen(
        (message) {
          _isConnecting = false;
          try {
            final decoded = json.decode(message);
            _wsController.add(decoded);
          } catch (e) {
            print('WS parse error: $e');
          }
        },
        onError: (error) {
          print('WS stream error: $error');
          _isConnecting = false;
          _reconnectWS();
        },
        onDone: () {
          print('WS closed');
          _channel = null;
          _isConnecting = false;
          _reconnectWS();
        },
        cancelOnError: true,
      );
    } catch (e) {
      _isConnecting = false;
      _channel = null;
      print('WS connect error (Internet down?): $e');
      _reconnectWS();
    }
  }

  void _reconnectWS() {
    Future.delayed(const Duration(seconds: 5), () {
      // Evitar reconexiones duplicadas asegurando que no haya un canal activo
      if (_cookie != null && _channel == null && !_isConnecting) {
        connectWebSocket();
      }
    });
  }

  void disconnectWebSocket() {
    _channel?.sink.close();
    _channel = null;
  }

  Future<List<dynamic>> getDevices({int? geofenceId}) async {
    if (_cookie == null) return [];
    try {
      final url = geofenceId != null
          ? '$baseUrl/devices?geofenceId=$geofenceId'
          : '$baseUrl/devices';
      final response = await http.get(
        Uri.parse(url),
        headers: {'Cookie': _cookie!},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  Future<List<dynamic>> getPositions() async {
    if (_cookie == null) return [];
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/positions'),
        headers: {'Cookie': _cookie!},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  Future<bool> sendCommand(int deviceId, String type, {String? data}) async {
    if (_cookie == null) return false;
    try {
      // Asegurar que attributes se envíe como Map<String,dynamic> para soportar valores complejos
      final Map<String, dynamic> payload = {'deviceId': deviceId, 'type': type};
      if (data != null && data.isNotEmpty) {
        payload['attributes'] = <String, dynamic>{'data': data};
      }

      final response = await http.post(
        Uri.parse('$baseUrl/commands/send'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(payload),
      );

      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (e) {
      print('Command error: $e');
      return false;
    }
  }

  // --- REPORT ENDPOINTS ---

  Future<List<dynamic>> getTrips(int deviceId, String from, String to) async {
    return _fetchReport('trips', deviceId, from, to);
  }

  Future<List<dynamic>> getStops(int deviceId, String from, String to) async {
    return _fetchReport('stops', deviceId, from, to);
  }

  Future<List<dynamic>> getEvents(int deviceId, String from, String to) async {
    return _fetchReport('events', deviceId, from, to);
  }

  Future<List<dynamic>> getSummary(int deviceId, String from, String to) async {
    return _fetchReport('summary', deviceId, from, to);
  }

  Future<List<dynamic>> getRoute(int deviceId, String from, String to) async {
    return _fetchReport('route', deviceId, from, to);
  }

  Future<List<dynamic>> _fetchReport(
    String reportType,
    int deviceId,
    String from,
    String to,
  ) async {
    if (_cookie == null) return [];
    try {
      final uri = Uri.parse(
        '$baseUrl/reports/$reportType?deviceId=$deviceId&from=${Uri.encodeComponent(from)}&to=${Uri.encodeComponent(to)}',
      );
      final response = await http.get(
        uri,
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Report error ($reportType): $e');
      return [];
    }
  }

  // --- USER PROFILE ENDPOINTS ---
  Future<Map<String, dynamic>?> getUserSession() async {
    if (_cookie == null) return null;
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/session'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return null;
    } catch (e) {
      print('User session error: $e');
      return null;
    }
  }

  // --- NOTIFICATIONS CONFIG ---
  Future<List<dynamic>> getNotifications() async {
    if (_cookie == null) return [];
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/notifications'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Notifications error: $e');
      return [];
    }
  }

  Future<bool> updateNotification(
    int id,
    Map<String, dynamic> notificationData,
  ) async {
    if (_cookie == null) return false;
    try {
      final response = await http.put(
        Uri.parse('$baseUrl/notifications/$id'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(notificationData),
      );
      return response.statusCode == 200;
    } catch (e) {
      print('Update notification error: $e');
      return false;
    }
  }

  Future<Map<String, dynamic>?> createNotification(
    Map<String, dynamic> notificationData,
  ) async {
    if (_cookie == null) return null;
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/notifications'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(notificationData),
      );
      if (response.statusCode == 200 || response.statusCode == 201) {
        return json.decode(response.body);
      }
      return null;
    } catch (e) {
      print('Create notification error: $e');
      return null;
    }
  }

  /// Asegura que existan notificaciones de ignitionOn e ignitionOff en Traccar,
  /// y las vincula a todos los vehículos del usuario. Robusto: si ya existen no duplica.
  Future<void> ensureIgnitionNotifications() async {
    if (_cookie == null) return;
    try {
      final existing = await getNotifications();
      final devices = await getDevices();

      // Todos los tipos de eventos criticos que queremos recibir por push
      const criticalTypes = [
        'ignitionOn',
        'ignitionOff',
        'geofenceEnter',
        'geofenceExit',
        'deviceOffline',
        'deviceOnline',
        'alarm',
      ];

      for (final type in criticalTypes) {
        final alreadyExists = existing.any((n) => n['type'] == type);
        int notifId;

        if (alreadyExists) {
          notifId = existing.firstWhere((n) => n['type'] == type)['id'];
        } else {
          final newNotif = await createNotification({
            'type': type,
            'always': true,
            'notificators': 'firebase',
            'attributes': {},
          });
          if (newNotif == null) continue;
          notifId = newNotif['id'];
        }

        // Vincular a todos los dispositivos (ignorar errores si ya está vinculado)
        for (final device in devices) {
          await linkPermission({
            'deviceId': device['id'],
            'notificationId': notifId,
          });
        }
      }
      print('✅ All critical notifications ensured and linked.');
    } catch (e) {
      print('ensureIgnitionNotifications error: $e');
    }
  }

  // --- GEOFENCES ---
  Future<List<dynamic>> getGeofences() async {
    if (_cookie == null) return [];
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/geofences'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Geofences error: $e');
      return [];
    }
  }

  // --- MAINTENANCE ---
  Future<List<dynamic>> getMaintenance() async {
    if (_cookie == null) return [];
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/maintenance'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Maintenance error: $e');
      return [];
    }
  }

  // --- DRIVERS ---
  Future<List<dynamic>> getDrivers({int? deviceId}) async {
    if (_cookie == null) return [];
    try {
      final url = deviceId != null
          ? '$baseUrl/drivers?deviceId=$deviceId'
          : '$baseUrl/drivers';
      final response = await http.get(
        Uri.parse(url),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Drivers error: $e');
      return [];
    }
  }

  Future<bool> createDriver(Map<String, dynamic> driverData) async {
    if (_cookie == null) return false;
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/drivers'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(driverData),
      );
      return response.statusCode == 200 || response.statusCode == 201;
    } catch (e) {
      print('Create driver error: $e');
      return false;
    }
  }

  Future<bool> updateDriver(int id, Map<String, dynamic> driverData) async {
    if (_cookie == null) return false;
    try {
      final response = await http.put(
        Uri.parse('$baseUrl/drivers/$id'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(driverData),
      );
      return response.statusCode == 200;
    } catch (e) {
      print('Update driver error: $e');
      return false;
    }
  }

  Future<bool> deleteDriver(int id) async {
    if (_cookie == null) return false;
    try {
      final response = await http.delete(
        Uri.parse('$baseUrl/drivers/$id'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      return response.statusCode == 204 || response.statusCode == 200;
    } catch (e) {
      print('Delete driver error: $e');
      return false;
    }
  }

  // --- USERS ---
  Future<List<dynamic>> getUsers() async {
    if (_cookie == null) return [];
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/users'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Users error: $e');
      return [];
    }
  }

  Future<bool> createUser(Map<String, dynamic> userData) async {
    if (_cookie == null) return false;
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/users'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(userData),
      );
      return response.statusCode == 200 || response.statusCode == 201;
    } catch (e) {
      print('Create user error: $e');
      return false;
    }
  }

  Future<bool> deleteUser(int id) async {
    if (_cookie == null) return false;
    try {
      final response = await http.delete(
        Uri.parse('$baseUrl/users/$id'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      return response.statusCode == 204 || response.statusCode == 200;
    } catch (e) {
      print('Delete user error: $e');
      return false;
    }
  }

  Future<bool> updateUser(int id, Map<String, dynamic> userData) async {
    if (_cookie == null) return false;
    try {
      final response = await http.put(
        Uri.parse('$baseUrl/users/$id'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(userData),
      );
      return response.statusCode == 200;
    } catch (e) {
      print('Update user error: $e');
      return false;
    }
  }

  // --- GROUPS ---
  Future<List<dynamic>> getGroups() async {
    if (_cookie == null) return [];
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/groups'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
      return [];
    } catch (e) {
      print('Groups error: $e');
      return [];
    }
  }

  Future<bool> createGroup(Map<String, dynamic> groupData) async {
    if (_cookie == null) return false;
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/groups'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(groupData),
      );
      return response.statusCode == 200 || response.statusCode == 201;
    } catch (e) {
      print('Create group error: $e');
      return false;
    }
  }

  Future<bool> updateGroup(int id, Map<String, dynamic> groupData) async {
    if (_cookie == null) return false;
    try {
      final response = await http.put(
        Uri.parse('$baseUrl/groups/$id'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(groupData),
      );
      return response.statusCode == 200;
    } catch (e) {
      print('Update group error: $e');
      return false;
    }
  }

  Future<bool> deleteGroup(int id) async {
    if (_cookie == null) return false;
    try {
      final response = await http.delete(
        Uri.parse('$baseUrl/groups/$id'),
        headers: {'Cookie': _cookie!, 'Accept': 'application/json'},
      );
      return response.statusCode == 204 || response.statusCode == 200;
    } catch (e) {
      print('Delete group error: $e');
      return false;
    }
  }

  // --- PERMISSIONS (Vinculaciones) ---
  Future<String> linkPermission(Map<String, dynamic> body) async {
    if (_cookie == null) return 'No autenticado';
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/permissions'),
        headers: {
          'Cookie': _cookie!,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: json.encode(body),
      );
      if (response.statusCode == 200 || response.statusCode == 204) {
        return 'OK';
      } else {
        return '${response.statusCode}: ${response.body}';
      }
    } catch (e) {
      print('Link permission error: $e');
      return e.toString();
    }
  }

  Future<String> unlinkPermission(Map<String, dynamic> body) async {
    if (_cookie == null) return 'No autenticado';
    // Cerrar el cliente HTTP temporal para liberar los recursos de red
    final client = http.Client();
    try {
      final request = http.Request('DELETE', Uri.parse('$baseUrl/permissions'))
        ..headers['Cookie'] = _cookie!
        ..headers['Content-Type'] = 'application/json'
        ..headers['Accept'] = 'application/json'
        ..body = json.encode(body);

      final streamedResponse = await client.send(request);
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200 || response.statusCode == 204) {
        return 'OK';
      } else {
        return '${response.statusCode}: ${response.body}';
      }
    } catch (e) {
      print('Unlink permission error: $e');
      return e.toString();
    } finally {
      client.close();
    }
  }
}
