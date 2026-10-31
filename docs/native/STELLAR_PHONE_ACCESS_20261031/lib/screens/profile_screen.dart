import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/traccar_service.dart';
import 'groups_screen.dart';
import 'geofences_screen.dart';
import 'maintenance_screen.dart';
import 'drivers_screen.dart';
import 'taxi_owner_screen.dart';
import 'users_screen.dart';
import '../widgets/animated_list_item.dart';
import 'notification_settings_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _user;
  bool _loading = true;
  bool _savingSettings = false;
  bool _savingSecurity = false;

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();

  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  String _mapType = 'roadmap';

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    final prefs = await SharedPreferences.getInstance();
    final savedMapType = prefs.getString('estrella_map_type') ?? 'roadmap';

    final user = await TraccarService().getUserSession();

    if (mounted) {
      setState(() {
        _mapType = savedMapType;
        if (user != null) {
          _user = user;
          _nameController.text = user['name'] ?? '';
          _emailController.text = user['email'] ?? '';
          _phoneController.text = user['phone'] ?? '';
        }
        _loading = false;
      });
    }
  }

  void _showSuccess(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle, color: Colors.white),
            const SizedBox(width: 8),
            Text(message),
          ],
        ),
        backgroundColor: Colors.green.shade600,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red.shade600,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _saveSettings() async {
    if (_user == null) return;

    setState(() => _savingSettings = true);

    // Guardar preferencia de mapa
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('estrella_map_type', _mapType);
    if (TraccarService().taxiAccess?.personal == true) {
      if (mounted) {
        setState(() => _savingSettings = false);
        _showSuccess('Preferencia de mapa guardada.');
      }
      return;
    }

    // Evitar sobreescribir los campos de seguridad enviando parámetros internos
    final updatedUser = Map<String, dynamic>.from(_user!);
    updatedUser['name'] = _nameController.text;
    updatedUser['email'] = _emailController.text;
    updatedUser['phone'] = _phoneController.text;
    updatedUser.remove('password'); // nunca reenviar password
    updatedUser.remove('totpKey'); // campo interno de 2FA
    updatedUser.remove('temporary'); // campo interno

    final success = await TraccarService().updateUser(
      _user!['id'],
      updatedUser,
    );

    if (mounted) {
      setState(() => _savingSettings = false);
      if (success) {
        _user = updatedUser;
        _showSuccess('Ajustes guardados correctamente.');
      } else {
        _showError('Error al guardar ajustes.');
      }
    }
  }

  Future<void> _saveSecurity() async {
    if (_user == null) return;

    final password = _passwordController.text;
    final confirm = _confirmPasswordController.text;

    if (password.isEmpty) {
      _showError('Ingresa una contraseña nueva.');
      return;
    }
    if (password != confirm) {
      _showError('Las contraseñas no coinciden.');
      return;
    }
    if (password.length < 5) {
      _showError('La contraseña debe tener al menos 5 caracteres.');
      return;
    }

    setState(() => _savingSecurity = true);

    // Actualizar unicamente la contraseña sin reenviar el resto de atributos sensibles
    final updatedUser = Map<String, dynamic>.from(_user!);
    updatedUser['password'] = password;
    updatedUser.remove('totpKey');
    updatedUser.remove('temporary');

    final success = await TraccarService().updateUser(
      _user!['id'],
      updatedUser,
    );

    if (mounted) {
      setState(() => _savingSecurity = false);
      if (success) {
        _passwordController.clear();
        _confirmPasswordController.clear();
        _showSuccess('Contraseña actualizada con éxito.');
      } else {
        _showError('Error al actualizar contraseña.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final access = TraccarService().taxiAccess;
    if (_loading) {
      return const Scaffold(
        backgroundColor: Color(0xFFF8FAFC),
        body: Center(child: CircularProgressIndicator(color: Colors.blue)),
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.black87),
        title: const Row(
          children: [
            Icon(Icons.settings, color: Colors.blue, size: 24),
            SizedBox(width: 8),
            Text(
              'Ajustes y Perfil',
              style: TextStyle(
                color: Colors.black87,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            AnimatedListItem(index: 0, child: _buildProfilePanel()),
            const SizedBox(height: 24),

            if (access?.nativeAdministrator == true)
              AnimatedListItem(
                index: 1,
                child: _buildSection(
                  title: 'ADMINISTRACIÓN',
                  children: [
                    _buildListTile(
                      icon: Icons.map,
                      title: 'Geocercas (Zonas)',
                      subtitle: 'Configura áreas en el mapa',
                      trailing: const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: Colors.grey,
                      ),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => const GeofencesScreen(),
                          ),
                        );
                      },
                    ),
                    const Divider(height: 1, indent: 56),
                    _buildListTile(
                      icon: Icons.car_repair,
                      title: 'Mantenimientos',
                      subtitle: 'Servicios de rutina',
                      trailing: const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: Colors.grey,
                      ),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => const MaintenanceScreen(),
                          ),
                        );
                      },
                    ),
                    const Divider(height: 1, indent: 56),
                    _buildListTile(
                      icon: Icons.layers_outlined,
                      title: 'Flotillas',
                      subtitle: 'Agrupar vehículos',
                      trailing: const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: Colors.grey,
                      ),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => const GroupsScreen(),
                          ),
                        );
                      },
                    ),
                    const Divider(height: 1, indent: 56),
                    _buildListTile(
                      icon: Icons.people_alt_outlined,
                      title: 'Usuarios',
                      subtitle: 'Administradores y clientes',
                      trailing: const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: Colors.grey,
                      ),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => const UsersScreen(),
                          ),
                        );
                      },
                    ),
                    const Divider(height: 1, indent: 56),
                    if (_user?['administrator'] == true)
                      _buildListTile(
                        icon: Icons.badge_outlined,
                        title: 'Conductores',
                        subtitle: 'Choferes e iButtons',
                        trailing: const Icon(
                          Icons.chevron_right,
                          size: 20,
                          color: Colors.grey,
                        ),
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (context) => const DriversScreen(),
                            ),
                          );
                        },
                      ),
                  ],
                ),
              ),
            if (access?.personal == true)
              AnimatedListItem(
                index: 1,
                child: _buildSection(
                  title: access!.label,
                  children: [
                    _buildListTile(
                      icon: Icons.local_taxi_outlined,
                      title: access.taxiLabel,
                      subtitle: access.ownsTaxi
                          ? 'Choferes, números y quién está en turno'
                          : 'Mi unidad, mis datos y acceso a viajes',
                      trailing: const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: Colors.grey,
                      ),
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => const TaxiOwnerScreen(),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 24),

            AnimatedListItem(
              index: 2,
              child: _buildSection(
                title: 'PREFERENCIAS',
                children: [
                  _buildListTile(
                    icon: Icons.notifications_active,
                    title: 'Configurar mis Alertas',
                    subtitle: 'Push, WhatsApp y Correo',
                    trailing: const Icon(
                      Icons.chevron_right,
                      size: 20,
                      color: Colors.grey,
                    ),
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) =>
                              const NotificationSettingsScreen(),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            if (access != null && !access.personal)
              AnimatedListItem(index: 3, child: _buildSecurityPanel()),
            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }

  Widget _buildProfilePanel() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(20),
              ),
              border: Border(bottom: BorderSide(color: Colors.grey.shade100)),
            ),
            child: Row(
              children: [
                Icon(Icons.public, color: Colors.grey.shade700, size: 20),
                const SizedBox(width: 8),
                const Text(
                  'Perfil y Apariencia',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildTextField('Nombre de Usuario', _nameController),
                const SizedBox(height: 16),
                _buildTextField(
                  'Número de WhatsApp (Teléfono)',
                  _phoneController,
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 4),
                Text(
                  TraccarService().taxiAccess?.personal == true
                      ? 'El WhatsApp de viajes se consulta en Mi taxi y turno.'
                      : 'Requerido para recibir alertas del GPS.',
                  style: const TextStyle(fontSize: 11, color: Colors.grey),
                ),
                const SizedBox(height: 16),
                if (TraccarService().taxiAccess?.personal != true)
                  _buildTextField(
                    'Correo Electrónico',
                    _emailController,
                    keyboardType: TextInputType.emailAddress,
                  ),
                const SizedBox(height: 24),
                const Divider(),
                const SizedBox(height: 16),
                const Row(
                  children: [
                    Icon(Icons.map_outlined, size: 18, color: Colors.grey),
                    SizedBox(width: 8),
                    Text(
                      'Capa del Mapa (Predeterminada)',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Colors.grey,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _buildMapOption(
                        'roadmap',
                        'Estándar',
                        'Calles y rutas',
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildMapOption(
                        'satellite',
                        'Satélite',
                        'Vista real (Google)',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: const BorderRadius.vertical(
                bottom: Radius.circular(20),
              ),
              border: Border(top: BorderSide(color: Colors.grey.shade100)),
            ),
            child: ElevatedButton(
              onPressed: _savingSettings ? null : _saveSettings,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: _savingSettings
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : const Text(
                      'Guardar Preferencias',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSecurityPanel() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(20),
              ),
              border: Border(bottom: BorderSide(color: Colors.grey.shade100)),
            ),
            child: Row(
              children: [
                Icon(Icons.lock_outline, color: Colors.grey.shade700, size: 20),
                const SizedBox(width: 8),
                const Text(
                  'Seguridad',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.amber.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.amber.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.info_outline,
                        color: Colors.amber.shade700,
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Usa este panel solo si deseas cambiar tu contraseña actual. Si no, déjalo en blanco.',
                          style: TextStyle(
                            color: Colors.amber.shade800,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                _buildTextField(
                  'Nueva Contraseña',
                  _passwordController,
                  isPassword: true,
                ),
                const SizedBox(height: 16),
                _buildTextField(
                  'Confirmar Contraseña',
                  _confirmPasswordController,
                  isPassword: true,
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: const BorderRadius.vertical(
                bottom: Radius.circular(20),
              ),
              border: Border(top: BorderSide(color: Colors.grey.shade100)),
            ),
            child: ElevatedButton(
              onPressed: _savingSecurity ? null : _saveSecurity,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF111827),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: _savingSecurity
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2,
                      ),
                    )
                  : const Text(
                      'Actualizar Contraseña',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(
    String label,
    TextEditingController controller, {
    bool isPassword = false,
    TextInputType? keyboardType,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 12,
            color: Color(0xFF475569),
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          readOnly: TraccarService().taxiAccess?.personal != false,
          controller: controller,
          obscureText: isPassword,
          keyboardType: keyboardType,
          style: const TextStyle(
            fontSize: 14,
            color: Color(0xFF0F172A),
            fontWeight: FontWeight.w500,
          ),
          decoration: InputDecoration(
            filled: true,
            fillColor: Colors.white,
            hintText: 'Ingresa $label...',
            hintStyle: const TextStyle(
              color: Colors.black38,
              fontSize: 13,
              fontWeight: FontWeight.normal,
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.grey.shade300),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: Colors.blue, width: 2),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMapOption(String value, String title, String subtitle) {
    final isSelected = _mapType == value;
    return GestureDetector(
      onTap: () => setState(() => _mapType = value),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          color: isSelected ? Colors.blue.shade50 : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? Colors.blue : Colors.grey.shade200,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 14,
                color: isSelected ? Colors.blue.shade700 : Colors.black87,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: const TextStyle(fontSize: 10, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(20),
              ),
              border: Border(bottom: BorderSide(color: Colors.grey.shade100)),
            ),
            child: Text(
              title,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: Colors.grey,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _buildListTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget trailing,
    required VoidCallback onTap,
  }) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Colors.blue.withOpacity(0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: Colors.blue, size: 22),
      ),
      title: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.bold,
          fontSize: 15,
          color: Color(0xFF0F172A),
        ),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
      ),
      trailing: trailing,
    );
  }
}
