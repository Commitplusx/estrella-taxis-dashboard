import 'package:flutter/material.dart';

import 'dart:async';

import 'dashboard_screen.dart';
import 'map_screen.dart';
import 'devices_screen.dart';
import 'reports_screen.dart';
import 'profile_screen.dart';
import 'notifications_screen.dart';
import 'replay_screen.dart';
import '../services/traccar_service.dart';
import '../services/notification_service.dart';
import '../widgets/animated_scale_button.dart';

import 'package:firebase_messaging/firebase_messaging.dart';

import '../services/taxi_app_access.dart';
import '../services/taxi_owner_client.dart';
import 'taxi_owner_screen.dart';
import '../services/driver_location_service.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> with WidgetsBindingObserver {
  TaxiAppAccess? _access;
  String? _accessError;
  int _accessRequest = 0;
  Future<void> _loadAccess() async {
    final request = ++_accessRequest;
    final tracking = TraccarService();
    final cookie = tracking.trackingSession;
    final client = TaxiOwnerClient(session: () => cookie);
    if (mounted) {
      setState(() {
        _access = null;
        _accessError = null;
      });
    }
    tracking.taxiAccess = null;
    try {
      final user = await tracking.getUserSession();
      if (user == null) {
        throw const TaxiOwnerException('Inicia sesión otra vez con tu correo.');
      }
      final access = await TaxiAppAccess.load(
        client,
        administrator: user['administrator'] == true,
      );
      if (!mounted ||
          request != _accessRequest ||
          cookie != tracking.trackingSession) {
        return;
      }
      tracking.taxiAccess = access;
      if (access.personal) {
        await DriverLocationService.instance.configure(cookie);
        await DriverLocationService.instance.refresh();
      }
      if (!mounted || request != _accessRequest || cookie != tracking.trackingSession) return;
      setState(() {
        _access = access;
        if (!access.advanced && _currentIndex == 1) _currentIndex = 0;
        _isMenuExpanded = false;
      });
    } catch (error) {
      if (mounted && request == _accessRequest) {
        setState(
          () => _accessError = error is TaxiOwnerException
              ? error.message
              : 'No pudimos comprobar tu acceso. Vuelve a intentarlo.',
        );
      }
    } finally {
      client.close();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _loadAccess();
  }

  int _currentIndex = 0; // Default to Map (index 0)
  bool _isMenuExpanded = false;
  String? _activeMenuAction;
  int? _contextualDeviceId;
  final GlobalKey<MapScreenState> _mapScreenKey = GlobalKey<MapScreenState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadAccess();
    _setupForegroundNotifications();
    _setupWebSocketNotifications(); // Incluye actualización de nombres de dispositivo
  }

  StreamSubscription? _wsSubscription;

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _wsSubscription?.cancel();
    super.dispose();
  }

  /// Mapa de estado anterior por dispositivo para detectar cambios
  final Map<int, Map<String, dynamic>> _prevState = {};

  /// Escucha posiciones del WebSocket y detecta cambios de estado de ignición
  void _setupWebSocketNotifications() {
    _wsSubscription = TraccarService().wsStream.listen((data) {
      if (!mounted) return;

      // Actualizar nombres de dispositivos
      final devices = data['devices'] as List<dynamic>?;
      if (devices != null) _updateDeviceNames(devices);

      // Traccar envía positions con attributes que incluyen ignition, speed, etc.
      final positions = data['positions'] as List<dynamic>?;
      if (positions == null || positions.isEmpty) return;

      for (final pos in positions) {
        final int deviceId = pos['deviceId'] ?? 0;
        final attrs = pos['attributes'] as Map<String, dynamic>? ?? {};
        final bool? ignition = attrs['ignition'] as bool?;
        final double speed = (pos['speed'] as num? ?? 0).toDouble();
        final String? result = attrs['result']?.toString();
        final String deviceName = _getDeviceName(deviceId);

        // DEBUG TEMPORAL
        debugPrint(
          '📍 POS device=$deviceId name=$deviceName speed=$speed ignition=$ignition attrs=$attrs',
        );

        final prev = _prevState[deviceId];

        if (prev != null) {
          final bool? prevIgnition = prev['ignition'] as bool?;
          final double prevSpeed = (prev['speed'] as num? ?? 0).toDouble();
          final String? prevResult = prev['result'] as String?;

          // Detectar resultado de comando
          if (result != null && result != prevResult) {
            debugPrint('⚠️ COMMAND RESULT FROM ATTRS: $result for $deviceName');
            _triggerNotification('commandResult', deviceName, {
              'result': result,
            });
          }
          // Detectar cambio de ignición (funciona con o sin sensor de ignición)
          else if (ignition != null &&
              prevIgnition != null &&
              ignition != prevIgnition) {
            final type = ignition ? 'ignitionOn' : 'ignitionOff';
            debugPrint('🔥 IGNITION CHANGE: $type for $deviceName');
            _triggerNotification(type, deviceName, {});
          }
          // Detectar inicio de movimiento (speed 0 → >2 km/h) - aplica para todos los vehículos
          else if (prevSpeed < 2 && speed >= 2) {
            debugPrint('🚗 MOVING: $deviceName speed=$speed');
            _triggerNotification('deviceMoving', deviceName, {});
          }
          // Detectar detención (speed >2 → 0) - aplica para todos los vehículos
          else if (prevSpeed >= 2 && speed < 1) {
            debugPrint('🈿 STOPPED: $deviceName');
            _triggerNotification('deviceStopped', deviceName, {});
          }
        }

        // Guardar estado actual
        _prevState[deviceId] = {
          'ignition': ignition,
          'speed': speed,
          'result': result,
        };
      }

      // Procesar EVENTOS explícitos de Traccar (alarmas, pérdida de conexión, comandos)
      final events = data['events'] as List<dynamic>?;
      if (events != null && events.isNotEmpty) {
        for (final event in events) {
          final type = event['type'] as String? ?? '';
          final int deviceId = event['deviceId'] as int? ?? 0;
          final String deviceName = _getDeviceName(deviceId);

          if (type == 'commandResult') {
            debugPrint('⚠️ COMMAND RESULT EVENT: $event');
            _triggerNotification('commandResult', deviceName, event);
          } else if ([
            'alarm', 'deviceOffline', 'deviceOnline',
            'geofenceEnter',
            'geofenceExit', // Incluir notificaciones de geocercas
            'deviceOverspeed',
          ].contains(type)) {
            debugPrint('🚨 TRACCAR EVENT: $type for $deviceName');
            _triggerNotification(type, deviceName, event);
          }
        }
      }
    });
  }

  String _getDeviceName(int deviceId) {
    // El deviceId se cachea en el stream; nombre se obtiene al siguiente update de devices
    return _deviceNames[deviceId] ?? 'Vehículo';
  }

  final Map<int, String> _deviceNames = {};

  void _updateDeviceNames(List<dynamic> devices) {
    for (final d in devices) {
      _deviceNames[d['id'] as int] = d['name'] as String? ?? 'Vehículo';
    }
  }

  // _listenForDeviceNames está fusionado con _setupWebSocketNotifications
  // para evitar dos suscripciones abiertas al mismo stream.

  bool _shouldNotify(String type) {
    const notifiableEvents = {
      'ignitionOn',
      'ignitionOff',
      'geofenceEnter',
      'geofenceExit',
      'deviceOffline',
      'alarm',
      'deviceOverspeed',
      'deviceMoving',
      'deviceStopped',
    };
    return notifiableEvents.contains(type);
  }

  void _triggerNotification(
    String type,
    String deviceName,
    Map<String, dynamic> event,
  ) {
    // Datos extra del evento (geofence name, etc.)
    final geofenceName = event['geofenceId']?.toString() ?? '';
    final dataMap = <String, dynamic>{
      'type': type,
      'deviceName': deviceName,
      'geofenceName': geofenceName,
    };

    // Disparar notificación local nativa
    NotificationService().interceptLocal(type, deviceName, dataMap);

    // Si la app está abierta, también mostrar banner in-app elegante
    if (context.mounted) {
      _showInAppBanner(type, deviceName);
    }
  }

  void _showInAppBanner(String type, String deviceName) {
    final isUrgent = [
      'ignitionOn',
      'ignitionOff',
      'alarm',
      'deviceOffline',
      'deviceOverspeed',
    ].contains(type);
    final title = NotificationService().titleForEvent(type);
    final body = NotificationService().bodyForEvent(type, deviceName, {});

    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.15),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isUrgent
                    ? Icons.warning_amber_rounded
                    : Icons.notifications_active_rounded,
                color: Colors.white,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                      fontSize: 14,
                    ),
                  ),
                  Text(
                    body,
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
        backgroundColor: isUrgent
            ? const Color(0xFFDC2626).withOpacity(0.95)
            : const Color(0xFF0F172A).withOpacity(0.95),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: isUrgent ? Colors.red.shade300 : const Color(0xFF334155),
            width: 1,
          ),
        ),
        margin: const EdgeInsets.only(bottom: 100, left: 16, right: 16),
        elevation: 20,
        duration: const Duration(seconds: 5),
        action: SnackBarAction(
          label: 'VER',
          textColor: isUrgent ? Colors.yellow : const Color(0xFF818CF8),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const NotificationsScreen()),
            );
          },
        ),
      ),
    );
  }

  void _setupForegroundNotifications() async {
    // 1. Pedir permisos al sistema operativo (Obligatorio en Android 13+)
    await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    // 2. Escuchar notificaciones en primer plano delegadas a NotificationService
    // Ya no usamos onMessage.listen aquí porque NotificationService lo hace globalmente
  }

  late final List<Widget> _screens = [
    MapScreen(
      key: _mapScreenKey,
      onDeviceSelected: (deviceId) {
        if (mounted) setState(() => _contextualDeviceId = deviceId);
      },
    ),
    const DashboardScreen(),
    const DevicesScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    if (_access == null)
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: _accessError == null
                ? const CircularProgressIndicator()
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_accessError!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _loadAccess,
                        child: const Text('Comprobar acceso'),
                      ),
                      TextButton(
                        onPressed: () async {
                          await TraccarService().logout();
                          if (mounted) {
                            Navigator.pushNamedAndRemoveUntil(
                              context,
                              '/',
                              (route) => false,
                            );
                          }
                        },
                        child: const Text('Entrar con otra cuenta'),
                      ),
                    ],
                  ),
          ),
        ),
      );
    return Scaffold(
      resizeToAvoidBottomInset: false, // Evitar lag del mapa al abrir teclado
      backgroundColor: const Color(0xFFF8FAFC), // Web app background
      body: Stack(
        children: [
          // Pantallas con estado preservado y animación (Mapa siempre debajo para evitar glitch negro)
          Positioned.fill(
            child: Stack(
              children: [
                // 1. Mapa (Index 0) - Siempre renderizado sin Opacity
                IgnorePointer(ignoring: _currentIndex != 0, child: _screens[0]),

                // 2. Dashboard (Index 1) - Fade in sobre el mapa
                if (_access!.advanced)
                  AnimatedOpacity(
                    opacity: _currentIndex == 1 ? 1.0 : 0.0,
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeInOut,
                    child: IgnorePointer(
                      ignoring: _currentIndex != 1,
                      child: _screens[1],
                    ),
                  ),

                // 3. Devices (Index 2) - Fade in sobre el mapa
                AnimatedOpacity(
                  opacity: _currentIndex == 2 ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeInOut,
                  child: IgnorePointer(
                    ignoring: _currentIndex != 2,
                    child: _screens[2],
                  ),
                ),
              ],
            ),
          ),

          // Floating Pill Bottom Nav
          Positioned(
            bottom: 24,
            left: 0,
            right: 0,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeInOutCubic,
                  height: 60,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(30),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.12),
                        blurRadius: 40,
                        offset: const Offset(0, 12),
                      ),
                    ],
                    border: Border.all(color: Colors.grey.shade100),
                  ),
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 400),
                    switchInCurve: Curves.easeOutBack,
                    switchOutCurve: Curves.easeIn,
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: ScaleTransition(scale: animation, child: child),
                    ),
                    child: (_isMenuExpanded || _contextualDeviceId != null)
                        ? _buildMenuRow(
                            isContextual: _contextualDeviceId != null,
                          )
                        : _buildMainRow(),
                  ),
                ),

                // Botón dinámico derecho (Campana o Cerrar Sesión)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeInOutCubic,
                  width: (_currentIndex == 0 || _isMenuExpanded)
                      ? 72
                      : 0, // 60 width + 12 margin
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    physics: const NeverScrollableScrollPhysics(),
                    clipBehavior: Clip.none,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(width: 12),
                        AnimatedScale(
                          scale: (_currentIndex == 0 || _isMenuExpanded)
                              ? 1.0
                              : 0.0,
                          duration: const Duration(milliseconds: 500),
                          curve: Curves.easeOutBack,
                          child: AnimatedScaleButton(
                            onTap: () async {
                              if (_isMenuExpanded) {
                                // Acción de Cerrar Sesión
                                await TraccarService().logout();
                                if (mounted)
                                  Navigator.pushNamedAndRemoveUntil(
                                    context,
                                    '/',
                                    (route) => false,
                                  );
                              } else {
                                // Acción de Notificaciones
                                Navigator.push(
                                  context,
                                  _buildSlideUpRoute(
                                    const NotificationsScreen(),
                                  ),
                                );
                              }
                            },
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 400),
                              curve: Curves.easeInOut,
                              height: 60,
                              width: 60,
                              decoration: BoxDecoration(
                                color: _isMenuExpanded
                                    ? Colors.red.shade50
                                    : Colors.white,
                                shape: BoxShape.circle,
                                boxShadow: [
                                  BoxShadow(
                                    color: _isMenuExpanded
                                        ? Colors.red.withOpacity(0.2)
                                        : Colors.black.withOpacity(0.12),
                                    blurRadius: 40,
                                    offset: const Offset(0, 12),
                                  ),
                                ],
                                border: Border.all(
                                  color: _isMenuExpanded
                                      ? Colors.red.shade100
                                      : Colors.grey.shade100,
                                ),
                              ),
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 400),
                                transitionBuilder: (child, animation) =>
                                    RotationTransition(
                                      turns: animation,
                                      child: ScaleTransition(
                                        scale: animation,
                                        child: child,
                                      ),
                                    ),
                                child: _isMenuExpanded
                                    ? Icon(
                                        Icons.logout,
                                        key: const ValueKey('logout'),
                                        color: Colors.red.shade600,
                                        size: 26,
                                      )
                                    : Stack(
                                        key: const ValueKey('bell'),
                                        alignment: Alignment.center,
                                        children: [
                                          const Icon(
                                            Icons.notifications_none,
                                            color: Color(0xFF1F2937),
                                            size: 26,
                                          ),
                                          Positioned(
                                            top: 14,
                                            right: 14,
                                            child: Container(
                                              width: 10,
                                              height: 10,
                                              decoration: BoxDecoration(
                                                color: Colors.red,
                                                shape: BoxShape.circle,
                                                border: Border.all(
                                                  color: Colors.white,
                                                  width: 2,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMainRow() {
    return Row(
      key: const ValueKey('main_row'),
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildNavItem(0, Icons.map_outlined),
        const SizedBox(width: 4),
        if (_access?.advanced == true) ...[
          _buildNavItem(1, Icons.bar_chart),
          const SizedBox(width: 4),
        ],
        _buildNavItem(2, Icons.directions_car_outlined),
        const SizedBox(width: 4),
        _buildMenuToggleItem(isClose: false),
      ],
    );
  }

  Widget _buildMenuRow({bool isContextual = false}) {
    return Row(
      key: ValueKey(isContextual ? 'contextual_row' : 'menu_row'),
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildMenuToggleItem(isClose: true, isContextual: isContextual),
        const SizedBox(width: 4),
        if (_access?.advanced == true)
          _buildActionItem(
            Icons.play_circle_outline,
            'Replay',
            () async {
              setState(() => _activeMenuAction = 'Replay');
              await Future.delayed(const Duration(milliseconds: 150));
              if (mounted)
                await Navigator.push(
                  context,
                  _buildSlideUpRoute(
                    ReplayScreen(initialDeviceId: _contextualDeviceId),
                  ),
                );
              if (mounted) setState(() => _activeMenuAction = null);
            },
            isActive: _activeMenuAction == 'Replay',
            isContextual: isContextual,
          ),
        const SizedBox(width: 4),
        if (_access?.advanced == true)
          _buildActionItem(
            Icons.description_outlined,
            'Reportes',
            () async {
              setState(() => _activeMenuAction = 'Reportes');
              await Future.delayed(const Duration(milliseconds: 150));
              if (mounted)
                await Navigator.push(
                  context,
                  _buildSlideUpRoute(
                    ReportsScreen(initialDeviceId: _contextualDeviceId),
                  ),
                );
              if (mounted) setState(() => _activeMenuAction = null);
            },
            isActive: _activeMenuAction == 'Reportes',
            isContextual: isContextual,
          ),
        const SizedBox(width: 4),
        _buildActionItem(
          Icons.person_outline,
          'Perfil',
          () async {
            setState(() => _activeMenuAction = 'Perfil');
            await Future.delayed(const Duration(milliseconds: 150));
            if (mounted)
              await Navigator.push(
                context,
                _buildSlideUpRoute(const ProfileScreen()),
              );
            if (mounted) setState(() => _activeMenuAction = null);
          },
          isActive: _activeMenuAction == 'Perfil',
          isContextual: isContextual,
        ),
        if (_access?.personal == true) ...[
          const SizedBox(width: 4),
          _buildActionItem(
            Icons.local_taxi_outlined,
            _access!.taxiLabel,
            () async {
              await Navigator.push(
                context,
                _buildSlideUpRoute(const TaxiOwnerScreen()),
              );
              if (mounted) await _loadAccess();
            },
            isContextual: isContextual,
          ),
        ],
      ],
    );
  }

  Route _buildSlideUpRoute(Widget page) {
    return PageRouteBuilder(
      pageBuilder: (context, animation, secondaryAnimation) => page,
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        var tween = Tween(
          begin: const Offset(0.0, 0.05),
          end: Offset.zero,
        ).chain(CurveTween(curve: Curves.easeOutCubic));
        return SlideTransition(
          position: animation.drive(tween),
          child: FadeTransition(opacity: animation, child: child),
        );
      },
      transitionDuration: const Duration(milliseconds: 400),
    );
  }

  Widget _buildMenuToggleItem({
    required bool isClose,
    bool isContextual = false,
  }) {
    return AnimatedScaleButton(
      onTap: () {
        if (isContextual) {
          _mapScreenKey.currentState?.clearSelection();
        } else {
          setState(() => _isMenuExpanded = !_isMenuExpanded);
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        width: 54,
        height: 48,
        decoration: BoxDecoration(
          color: isClose
              ? (isContextual
                    ? const Color(0xFF2563EB)
                    : const Color(0xFF111827))
              : Colors.transparent,
          borderRadius: BorderRadius.circular(24),
          boxShadow: isClose
              ? [
                  BoxShadow(
                    color:
                        (isContextual
                                ? const Color(0xFF2563EB)
                                : const Color(0xFF111827))
                            .withOpacity(0.3),
                    blurRadius: 6,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Icon(
          isClose ? Icons.close : Icons.settings_outlined,
          size: 22,
          color: isClose ? Colors.white : const Color(0xFF1F2937),
        ),
      ),
    );
  }

  Widget _buildActionItem(
    IconData icon,
    String tooltip,
    VoidCallback onTap, {
    bool isDestructive = false,
    bool isActive = false,
    bool isContextual = false,
  }) {
    final activeColor = isContextual
        ? const Color(0xFF2563EB)
        : const Color(0xFF111827);

    return AnimatedScaleButton(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        width: 54,
        height: 48,
        decoration: BoxDecoration(
          color: isActive
              ? activeColor
              : (isDestructive
                    ? Colors.red.withOpacity(0.15)
                    : (isContextual
                          ? const Color(0xFFEFF6FF)
                          : Colors.black.withOpacity(0.05))),
          borderRadius: BorderRadius.circular(24),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: activeColor.withOpacity(0.3),
                    blurRadius: 6,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Icon(
          icon,
          size: 22,
          color: isActive
              ? Colors.white
              : (isDestructive
                    ? Colors.red.shade600
                    : (isContextual
                          ? const Color(0xFF2563EB)
                          : const Color(0xFF1F2937))),
        ),
      ),
    );
  }

  Widget _buildNavItem(int index, IconData icon) {
    final isActive = _currentIndex == index;
    return AnimatedScaleButton(
      onTap: () => setState(() {
        _currentIndex = index;
        _isMenuExpanded = false;
      }),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeOut,
        width: 54,
        height: 48,
        decoration: BoxDecoration(
          color: isActive
              ? const Color(0xFF111827)
              : Colors.transparent, // gray-900
          borderRadius: BorderRadius.circular(24),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: const Color(0xFF111827).withOpacity(0.3),
                    blurRadius: 6,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Icon(
          icon,
          size: 22,
          color: isActive ? Colors.white : const Color(0xFF1F2937), // gray-800
        ),
      ),
    );
  }
}
