import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/traccar_service.dart';
import 'main_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isLoading = false;
  bool _isResetMode = false;
  int _loginPhase = 0;
  String _loadingText = 'Iniciando Sesión...';
  String _error = '';

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _login() async {
    if (_emailController.text.isEmpty || _passwordController.text.isEmpty) {
      setState(() => _error = 'Por favor, ingresa tu correo y contraseña.');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = '';
      _loginPhase = 1;
      _loadingText = 'Verificando credenciales...';
    });

    try {
      final success = await TraccarService().login(
        _emailController.text,
        _passwordController.text,
      );

      if (!success) {
        throw Exception('Credenciales inválidas.');
      }

      if (!mounted) return;

      // Fase 2
      setState(() {
        _loginPhase = 2;
        _loadingText = 'Sincronizando perfiles...';
      });
      await Future.delayed(const Duration(milliseconds: 700));
      if (!mounted) return;

      // Fase 3
      setState(() {
        _loginPhase = 3;
        _loadingText = 'Cargando motor de reportes...';
      });
      await Future.delayed(const Duration(milliseconds: 700));
      if (!mounted) return;

      // Fase 4
      setState(() {
        _loginPhase = 4;
        _loadingText = 'Recibiendo telemetría de vehículos...';
      });
      await Future.delayed(const Duration(milliseconds: 700));
      if (!mounted) return;

      // Fase 5
      setState(() {
        _loginPhase = 5;
        _loadingText = '¡Todo listo, bienvenido!';
      });
      await Future.delayed(const Duration(milliseconds: 800));

      if (mounted) {
        Navigator.pushReplacement(
          context,
          PageRouteBuilder(
            pageBuilder: (context, animation, secondaryAnimation) =>
                const MainScreen(),
            transitionsBuilder:
                (context, animation, secondaryAnimation, child) {
                  return FadeTransition(opacity: animation, child: child);
                },
            transitionDuration: const Duration(milliseconds: 800),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loginPhase = 0;
          _error =
              TraccarService().loginError ??
              'Error al iniciar sesión. Revisa tus credenciales.';
        });
      }
    }
  }

  void _performReset() async {
    if (_emailController.text.isEmpty || !_emailController.text.contains('@')) {
      setState(() => _error = 'Por favor, ingresa un correo válido.');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = '';
      _loadingText = 'Enviando enlace...';
    });

    try {
      final success = await TraccarService().resetPassword(
        _emailController.text,
      );
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Se ha enviado un correo con las instrucciones'),
            ),
          );
          setState(() => _isResetMode = false);
        } else {
          setState(
            () => _error = 'Error al procesar la solicitud (verifica que el SMTP esté activo).',
          );
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'Error al conectar con el servidor.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark, // Iconos oscuros para fondo claro
      child: Scaffold(
        backgroundColor: const Color(
          0xFFF8FAFC,
        ), // Fondo Slate 50 (casi blanco)
        body: SafeArea(
          child: SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight:
                    MediaQuery.of(context).size.height -
                    MediaQuery.of(context).padding.top -
                    MediaQuery.of(context).padding.bottom,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24.0,
                  vertical: 24.0,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Logo animado
                    TweenAnimationBuilder<double>(
                      tween: Tween<double>(begin: 0.8, end: 1.0),
                      duration: const Duration(seconds: 1),
                      curve: Curves.easeOutBack,
                      builder: (context, scale, child) {
                        return Transform.scale(scale: scale, child: child);
                      },
                      child: Center(
                        child: Container(
                          width: 120,
                          height: 120,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: _loginPhase == 5
                                    ? const Color(0xFF10B981).withOpacity(0.3)
                                    : const Color(
                                        0xFF2563EB,
                                      ).withOpacity(0.2), // Sombra azul suave
                                blurRadius: 30,
                                spreadRadius: 2,
                              ),
                            ],
                          ),
                          child: ClipOval(
                            child: Image.asset(
                              'assets/icon.png',
                              fit: BoxFit.cover,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 40),

                    // Tarjeta Blanca
                    Container(
                      padding: const EdgeInsets.all(32),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(32),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.04),
                            blurRadius: 30,
                            offset: const Offset(0, 10),
                          ),
                        ],
                        border: Border.all(color: Colors.grey.shade100),
                      ),
                      child: Column(
                        children: [
                          const Text(
                            'Stellar Tracking',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 26,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF0F172A), // Slate 900
                              letterSpacing: -0.5,
                            ),
                          ),
                          const SizedBox(height: 8),
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 300),
                            child: Text(
                              _isResetMode
                                  ? 'Ingresa tu correo para recuperar el acceso'
                                  : 'Plataforma de Rastreo y Telemetría',
                              key: ValueKey(_isResetMode),
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                                color: Color(0xFF64748B), // Slate 500
                              ),
                            ),
                          ),
                          const SizedBox(height: 32),

                          // Error Banner
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 300),
                            height: _error.isNotEmpty ? 50 : 0,
                            margin: EdgeInsets.only(
                              bottom: _error.isNotEmpty ? 16 : 0,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEF2F2), // Red 50
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: const Color(0xFFFECACA),
                              ), // Red 200
                            ),
                            child: Center(
                              child: Text(
                                _error,
                                style: const TextStyle(
                                  color: Color(0xFFDC2626),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ), // Red 600
                              ),
                            ),
                          ),

                          // Form Inputs (hide on success)
                          AnimatedOpacity(
                            duration: const Duration(milliseconds: 500),
                            opacity: _loginPhase == 5 ? 0.0 : 1.0,
                            child: AnimatedSize(
                              duration: const Duration(milliseconds: 500),
                              curve: Curves.easeInOut,
                              alignment: Alignment.topCenter,
                              child: _loginPhase == 5
                                  ? const SizedBox(width: double.infinity)
                                  : Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            left: 4,
                                            bottom: 6,
                                          ),
                                          child: Text(
                                            _isResetMode
                                                ? 'Correo electrónico'
                                                : 'Número de WhatsApp o correo',
                                            style: const TextStyle(
                                              fontSize: 13,
                                              fontWeight: FontWeight.w700,
                                              color: Color(0xFF475569),
                                            ),
                                          ),
                                        ),
                                        TextField(
                                          controller: _emailController,
                                          keyboardType: _isResetMode
                                              ? TextInputType.emailAddress
                                              : TextInputType.text,
                                          enabled: !_isLoading,
                                          style: const TextStyle(
                                            color: Color(0xFF0F172A),
                                            fontWeight: FontWeight.w500,
                                            fontSize: 15,
                                          ),
                                          decoration: InputDecoration(
                                            hintText: _isResetMode
                                                ? 'tu@correo.com'
                                                : '10 dígitos o +52…',
                                            hintStyle: const TextStyle(
                                              color: Color(0xFF94A3B8),
                                            ),
                                            filled: true,
                                            fillColor: const Color(
                                              0xFFF8FAFC,
                                            ), // Slate 50
                                            contentPadding:
                                                const EdgeInsets.symmetric(
                                                  horizontal: 16,
                                                  vertical: 16,
                                                ),
                                            border: OutlineInputBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              borderSide: const BorderSide(
                                                color: Color(0xFFE2E8F0),
                                              ), // Slate 200
                                            ),
                                            enabledBorder: OutlineInputBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              borderSide: const BorderSide(
                                                color: Color(0xFFE2E8F0),
                                              ),
                                            ),
                                            focusedBorder: OutlineInputBorder(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              borderSide: const BorderSide(
                                                color: Color(0xFF3B82F6),
                                                width: 2,
                                              ), // Blue 500
                                            ),
                                          ),
                                        ),
                                        AnimatedSize(
                                          duration: const Duration(
                                            milliseconds: 300,
                                          ),
                                          curve: Curves.easeInOut,
                                          child: _isResetMode
                                              ? const SizedBox.shrink()
                                              : Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  children: [
                                                    const SizedBox(height: 16),
                                                    const Padding(
                                                      padding: EdgeInsets.only(
                                                        left: 4,
                                                        bottom: 6,
                                                      ),
                                                      child: Text(
                                                        'Contraseña',
                                                        style: TextStyle(
                                                          fontSize: 13,
                                                          fontWeight:
                                                              FontWeight.w700,
                                                          color: Color(
                                                            0xFF475569,
                                                          ),
                                                        ),
                                                      ),
                                                    ),
                                                    TextField(
                                                      controller:
                                                          _passwordController,
                                                      obscureText: true,
                                                      enabled: !_isLoading,
                                                      style: const TextStyle(
                                                        color: Color(
                                                          0xFF0F172A,
                                                        ),
                                                        fontWeight:
                                                            FontWeight.w500,
                                                        fontSize: 15,
                                                      ),
                                                      decoration: InputDecoration(
                                                        hintText: '••••••••',
                                                        hintStyle:
                                                            const TextStyle(
                                                              color: Color(
                                                                0xFF94A3B8,
                                                              ),
                                                            ),
                                                        filled: true,
                                                        fillColor: const Color(
                                                          0xFFF8FAFC,
                                                        ),
                                                        contentPadding:
                                                            const EdgeInsets.symmetric(
                                                              horizontal: 16,
                                                              vertical: 16,
                                                            ),
                                                        border: OutlineInputBorder(
                                                          borderRadius:
                                                              BorderRadius.circular(
                                                                12,
                                                              ),
                                                          borderSide:
                                                              const BorderSide(
                                                                color: Color(
                                                                  0xFFE2E8F0,
                                                                ),
                                                              ),
                                                        ),
                                                        enabledBorder:
                                                            OutlineInputBorder(
                                                              borderRadius:
                                                                  BorderRadius.circular(
                                                                    12,
                                                                  ),
                                                              borderSide:
                                                                  const BorderSide(
                                                                    color: Color(
                                                                      0xFFE2E8F0,
                                                                    ),
                                                                  ),
                                                            ),
                                                        focusedBorder:
                                                            OutlineInputBorder(
                                                              borderRadius:
                                                                  BorderRadius.circular(
                                                                    12,
                                                                  ),
                                                              borderSide:
                                                                  const BorderSide(
                                                                    color: Color(
                                                                      0xFF3B82F6,
                                                                    ),
                                                                    width: 2,
                                                                  ),
                                                            ),
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                        ),
                                        const SizedBox(height: 12),
                                        Align(
                                          alignment: Alignment.centerRight,
                                          child: TextButton(
                                            onPressed: () {
                                              setState(() {
                                                _isResetMode = !_isResetMode;
                                                _error = '';
                                              });
                                            },
                                            style: TextButton.styleFrom(
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 8,
                                                    vertical: 4,
                                                  ),
                                              minimumSize: Size.zero,
                                              tapTargetSize:
                                                  MaterialTapTargetSize
                                                      .shrinkWrap,
                                            ),
                                            child: AnimatedSwitcher(
                                              duration: const Duration(
                                                milliseconds: 300,
                                              ),
                                              child: Text(
                                                _isResetMode
                                                    ? 'Volver al inicio de sesión'
                                                    : '¿Olvidaste tu contraseña?',
                                                key: ValueKey(_isResetMode),
                                                style: const TextStyle(
                                                  color: Color(
                                                    0xFF3B82F6,
                                                  ), // Blue 500
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 13,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                            ),
                          ),

                          SizedBox(height: _loginPhase == 5 ? 0 : 24),

                          // Submit Button
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 400),
                            width: double.infinity,
                            height: 54,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              gradient: LinearGradient(
                                colors: _loginPhase == 5
                                    ? [
                                        const Color(0xFF10B981),
                                        const Color(0xFF059669),
                                      ] // Emerald
                                    : [
                                        const Color(0xFF3B82F6),
                                        const Color(0xFF2563EB),
                                      ], // Blue 500 to 600
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: _loginPhase == 5
                                      ? const Color(0xFF10B981).withOpacity(0.4)
                                      : const Color(0xFF3B82F6)
                                            .withOpacity(0.4),
                                  blurRadius: 16,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: _isLoading
                                    ? null
                                    : (_isResetMode ? _performReset : _login),
                                borderRadius: BorderRadius.circular(12),
                                child: Center(
                                  child: _isLoading
                                      ? Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            if (_loginPhase < 5)
                                              const SizedBox(
                                                height: 18,
                                                width: 18,
                                                child: CircularProgressIndicator(
                                                  strokeWidth: 2.5,
                                                  valueColor:
                                                      AlwaysStoppedAnimation<
                                                        Color
                                                      >(Colors.white),
                                                ),
                                              ),
                                            if (_loginPhase == 5)
                                              const Icon(
                                                Icons.check_circle,
                                                color: Colors.white,
                                                size: 20,
                                              ),
                                            const SizedBox(width: 12),
                                            Flexible(
                                              child: Text(
                                                _loadingText,
                                                style: const TextStyle(
                                                  color: Colors.white,
                                                  fontSize: 14,
                                                  fontWeight: FontWeight.bold,
                                                  letterSpacing: 0.5,
                                                ),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                          ],
                                        )
                                      : AnimatedSwitcher(
                                          duration: const Duration(
                                            milliseconds: 300,
                                          ),
                                          child: Text(
                                            _isResetMode
                                                ? 'Enviar enlace de recuperación'
                                                : 'Entrar al Sistema',
                                            key: ValueKey(_isResetMode),
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 15,
                                              fontWeight: FontWeight.bold,
                                              letterSpacing: 0.5,
                                            ),
                                          ),
                                        ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
