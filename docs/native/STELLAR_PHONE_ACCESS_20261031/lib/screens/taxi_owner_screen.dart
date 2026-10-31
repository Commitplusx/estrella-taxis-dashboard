import 'package:flutter/material.dart';

import '../services/taxi_owner_client.dart';
import '../services/traccar_service.dart';
import '../services/tracking_data_client.dart';

class TaxiOwnerScreen extends StatefulWidget {
  const TaxiOwnerScreen({super.key});
  @override
  State<TaxiOwnerScreen> createState() => _TaxiOwnerScreenState();
}

class _TaxiOwnerScreenState extends State<TaxiOwnerScreen> {
  late final TaxiOwnerClient _client = TaxiOwnerClient(
    session: () => TraccarService().trackingSession,
  );
  TaxiPerson? _self;
  TaxiOwnerState? _taxi;
  String? _error, _notice;
  bool _busy = false;
  Map<String, Object?>? _pendingShift;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final person = await _client.self();
      final taxi = ['owner', 'owner_driver'].contains(person.role)
          ? await _client.read()
          : null;
      if (mounted) {
        setState(() {
          _self = person;
          _taxi = taxi;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = e is TaxiOwnerException
              ? e.message
              : 'No pudimos conectar. Usa Actualizar para intentarlo otra vez.',
        );
      }
    }
  }

  Future<void> _shift(String? contact) async {
    if (_busy || _taxi == null) return;
    final command =
        _pendingShift ??
        {
          'action': 'owner_shift',
          'requestId': TrackingDataClient.requestId(),
          'contactId': contact,
          'expected': _taxi!.driverVersion,
        };
    setState(() {
      _busy = true;
      _pendingShift = command;
      _error = null;
    });
    try {
      final result = await _client.save(command);
      if (mounted) {
        setState(() {
          _taxi = result;
          _pendingShift = null;
          _notice = 'Turno actualizado. Las ofertas llegan al WhatsApp del chofer en turno.';
        });
      }
    } catch (e) {
      TaxiOwnerState? refreshed;
      if (e is TaxiOwnerException && e.status == 409) {
        try {
          refreshed = await _client.read();
        } catch (_) {
          /* Keep the original error visible. */
        }
      }
      if (mounted) {
        setState(() {
          if (refreshed != null) _taxi = refreshed;
          _error = e is TaxiOwnerException
              ? e.message
              : 'No se confirmó el cambio. Comprueba la misma solicitud.';
          if (e is TaxiOwnerException && e.status >= 400 && e.status < 500) {
            _pendingShift = null;
          }
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _register([TaxiPerson? person]) async {
    TaxiSignup? pending;
    for (final item in _taxi!.pending) {
      if (item.contactId == person?.id) pending = item;
    }
    if (pending?.review == true) {
      setState(() => _error = 'Esta alta requiere revisión de la base.');
      return;
    }
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.white,
      builder: (_) => _RegistrationSheet(
        client: _client,
        unit: _taxi!.owner.unitNumber,
        person: person,
        pending: pending,
      ),
    );
    if (saved == true && mounted) {
      setState(
        () => _notice = 'Chofer vinculado. Entra con su número y contraseña. Elige Poner en turno cuando comience a trabajar.',
      );
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final taxi = _taxi;
    final locked = _busy || _pendingShift != null;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Mi taxi y turnos'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: locked ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_self == null && _error == null)
            const Center(child: CircularProgressIndicator()),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                _error!,
                style: const TextStyle(color: Color(0xFF991B1B)),
              ),
            ),
          if (_notice != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                _notice!,
                style: const TextStyle(color: Color(0xFF166534)),
              ),
            ),
          if (_self != null) ...[
            Text(
              'Unidad ${_self!.unitNumber}',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(_self!.name),
          ],
          if (taxi == null && _self != null) ...[
            const SizedBox(height: 24),
            Text(
              _self!.receiving
                  ? 'Estás en turno. Las ofertas llegan a tu WhatsApp.'
                  : 'Estás fuera de turno. El dueño de tu taxi selecciona quién recibe las ofertas.',
            ),
            const SizedBox(height: 8),
            Text(_self!.phone ?? 'Falta completar tu WhatsApp en la base.'),
          ],
          if (taxi != null) ...[
            const SizedBox(height: 24),
            Text(
              taxi.active
                  ? 'En turno: ${taxi.driverName}'
                  : 'Sin chofer en turno',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text(
              taxi.active ? 'Las ofertas llegan a ${taxi.driverPhone}.' : 'Pon un chofer en turno para recibir ofertas en esta unidad.',
            ),
            if (taxi.busy)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  'Hay un viaje u oferta pendiente. Podrás cambiar el turno cuando termine.',
                ),
              ),
            if (taxi.active)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: OutlinedButton(
                  onPressed: locked || taxi.busy ? null : () => _shift(null),
                  child: const Text('Terminar turno'),
                ),
              ),
            const Divider(height: 32),
            Text(
              'Choferes de esta unidad',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: locked || taxi.drivers.length >= 20 ? null : _register,
              icon: const Icon(Icons.person_add_outlined),
              label: const Text('Agregar chofer'),
            ),
            if (taxi.drivers.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('Agrega al primer chofer con nombre y WhatsApp.'),
              ),
            for (final person in taxi.drivers)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      person.name,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 6),
                    Text(person.phone ?? 'Falta WhatsApp'),
                    const SizedBox(height: 10),
                    if (person.accountId != null &&
                        !taxi.pending.any((p) => p.contactId == person.id))
                      OutlinedButton(
                        onPressed: locked || taxi.busy || person.receiving
                            ? null
                            : () => _shift(person.id),
                        child: Text(
                          person.receiving ? 'En turno' : 'Poner en turno',
                        ),
                      )
                    else
                      OutlinedButton(
                        onPressed: locked ? null : () => _register(person),
                        child: const Text('Completar acceso'),
                      ),
                    const Divider(height: 24),
                  ],
                ),
              ),
            if (_pendingShift != null)
              FilledButton(
                onPressed: _busy ? null : () => _shift(null),
                child: Text(
                  _busy ? 'Comprobando…' : 'Comprobar el mismo cambio',
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _RegistrationSheet extends StatefulWidget {
  final TaxiOwnerClient client;
  final String unit;
  final TaxiPerson? person;
  final TaxiSignup? pending;
  const _RegistrationSheet({
    required this.client,
    required this.unit,
    this.person,
    this.pending,
  });
  @override
  State<_RegistrationSheet> createState() => _RegistrationSheetState();
}

class _RegistrationSheetState extends State<_RegistrationSheet> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(
    text: widget.pending?.name ?? widget.person?.name ?? '',
  );
  late final _phone = TextEditingController(
    text: widget.pending?.phone ?? widget.person?.phone ?? '',
  );
  final _password = TextEditingController();
  late final String _request =
      widget.pending?.requestId ?? TrackingDataClient.requestId();
  late final String _contact =
      widget.person?.id ?? TrackingDataClient.requestId();
  Map<String, Object?>? _command;
  String? _error;
  bool _busy = false;
  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    final digits = _phone.text.replaceAll(RegExp(r'[^0-9+]'), '');
    final phone = RegExp(r'^\d{10}$').hasMatch(digits) ? '+52$digits' : digits;
    final command =
        _command ??
        {
          'action': 'owner_driver_save',
          'requestId': _request,
          'contactId': _contact,
          'expected': widget.pending != null
              ? widget.pending!.expected
              : widget.person?.version,
          'name': _name.text.trim(),
          'phone': phone,
          'email': widget.pending?.email,
          'password': _password.text,
        };
    setState(() {
      _command = command;
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.save(command);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e is TaxiOwnerException
              ? e.message
              : 'No se confirmó el alta. Comprueba la misma solicitud.';
          if (e is TaxiOwnerException && e.status >= 400 && e.status < 500) {
            _command = null;
          }
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final locked = _busy || _command != null;
    return PopScope(
      canPop: !_busy,
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(context).viewInsets.bottom + 20,
          ),
          child: SingleChildScrollView(
            child: Form(
              key: _form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Vincular chofer',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                      ),
                      IconButton(
                        tooltip: 'Cerrar',
                        onPressed: _busy ? null : () => Navigator.pop(context),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  Text(
                    'Quedará vinculado a la unidad ${widget.unit}. Tú eliges cuándo entra en turno.',
                  ),
                  const SizedBox(height: 22),
                  TextFormField(
                    controller: _name,
                    enabled: !locked && widget.pending == null,
                    maxLength: 120,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Nombre completo',
                    ),
                    validator: (v) => v == null || v.trim().isEmpty
                        ? 'Escribe su nombre'
                        : null,
                  ),
                  TextFormField(
                    controller: _phone,
                    enabled: !locked && widget.pending == null,
                    maxLength: 40,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'WhatsApp',
                      hintText: '10 dígitos o número con +52',
                    ),
                    validator: (v) =>
                        v == null ||
                            !RegExp(r'^(?:\d{10}|\+[1-9]\d{7,14})$')
                                .hasMatch(v.replaceAll(RegExp(r'[ ()-]'), ''))
                        ? 'Completa el WhatsApp con código de país'
                        : null,
                  ),
                  TextFormField(
                    controller: _password,
                    enabled: !locked,
                    obscureText: true,
                    maxLength: 128,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(
                      labelText: 'Contraseña inicial',
                    ),
                    validator: (v) => v != null && v.isNotEmpty && v.length < 12
                        ? 'Usa al menos 12 caracteres'
                        : null,
                  ),
                  const Text(
                    'Si ya tiene cuenta en la base, deja la contraseña vacía: se vincula la misma persona y conserva su taxi. Para alguien nuevo, crea una contraseña de al menos 12 caracteres.',
                  ),
                  const SizedBox(height: 16),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Color(0xFF991B1B)),
                      ),
                    ),
                  FilledButton(
                    onPressed: _busy ? null : _save,
                    child: Text(
                      _busy
                          ? 'Guardando…'
                          : _command != null
                          ? 'Comprobar la misma alta'
                          : 'Crear acceso del chofer',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
