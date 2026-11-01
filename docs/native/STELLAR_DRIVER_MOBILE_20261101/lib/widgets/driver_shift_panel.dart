import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../services/driver_location_service.dart';
import '../services/driver_shift_state.dart';

class DriverShiftPanel extends StatefulWidget {
  const DriverShiftPanel({super.key});
  @override
  State<DriverShiftPanel> createState() => _DriverShiftPanelState();
}

class _DriverShiftPanelState extends State<DriverShiftPanel> {
  int? _selected;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: DriverLocationService.instance,
    builder: (context, _) {
      final service = DriverLocationService.instance, state = service.state;
      if (state == null) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (service.error != null)
                Text(
                  service.error!,
                  style: const TextStyle(color: Color(0xFF991B1B)),
                ),
              OutlinedButton(
                onPressed: service.refresh,
                child: const Text('Consultar mi turno'),
              ),
            ],
          ),
        );
      }
      final active = state.activeUnit;
      DriverUnit? selected = active;
      for (final unit in state.units) {
        if (selected == null && unit.id == _selected) selected = unit;
      }
      selected ??= state.units.isNotEmpty ? state.units.first : null;
      final unit = selected;
      return Semantics(
        container: true,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 24),
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(
                    active == null
                        ? Icons.pause_circle_outline
                        : Icons.check_circle_outline,
                    color: active == null
                        ? const Color(0xFF64748B)
                        : const Color(0xFF166534),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      active == null
                          ? 'Mi turno está apagado'
                          : 'Estoy en turno',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (state.units.length > 1 && active == null)
                DropdownButtonFormField<int>(
                  initialValue: unit?.id,
                  decoration: const InputDecoration(
                    labelText: 'Unidad que voy a manejar',
                  ),
                  isExpanded: true,
                  items: state.units
                      .map(
                        (u) => DropdownMenuItem(
                          value: u.id,
                          child: Text(u.name, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: service.busy || service.hasPending
                      ? null
                      : (value) => setState(() => _selected = value),
                ),
              if (unit != null) ...[
                const SizedBox(height: 12),
                Text(
                  unit.name,
                  style: const TextStyle(color: Color(0xFF334155)),
                ),
                const SizedBox(height: 12),
                Text(
                  unit.occupiedByOther
                      ? 'Otro chofer está activo en esta unidad. Pide al dueño que libere el turno.'
                      : unit.busy
                      ? 'Tienes un viaje u oferta pendiente. Podrás terminar el turno cuando se resuelva.'
                      : active == null
                      ? 'Enciende tu turno cuando estés listo para recibir ofertas por WhatsApp.'
                      : 'Las ofertas de esta unidad llegan a tu WhatsApp.',
                  style: const TextStyle(color: Color(0xFF475569)),
                ),
                const SizedBox(height: 18),
                FilledButton.icon(
                  onPressed: service.busy || unit.busy || unit.occupiedByOther
                      ? null
                      : () => service.shift(unit, active == null),
                  icon: service.busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(
                          active == null
                              ? Icons.play_arrow
                              : Icons.stop_circle_outlined,
                        ),
                  label: Text(
                    service.busy
                        ? 'Comprobando…'
                        : service.hasPending
                        ? 'Comprobar cambio'
                        : active == null
                        ? 'Encender mi turno'
                        : 'Terminar mi turno',
                  ),
                ),
              ] else
                const Text(
                  'La base debe asignarte una unidad para activar tu turno.',
                  style: TextStyle(color: Color(0xFF475569)),
                ),
              if (service.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    service.error!,
                    style: const TextStyle(color: Color(0xFF991B1B)),
                  ),
                ),
              if (active != null) ...[
                const Divider(height: 32),
                Text(
                  service.locationNotice ??
                      'Comparte tu ubicación si la unidad no tiene GPS.',
                  style: const TextStyle(color: Color(0xFF475569)),
                ),
                if (!service.sharing)
                  TextButton.icon(
                    onPressed: service.busy ? null : service.startLocation,
                    icon: const Icon(Icons.my_location),
                    label: const Text('Compartir mi ubicación'),
                  ),
                if (!service.sharing)
                  TextButton(
                    onPressed: Geolocator.openAppSettings,
                    child: const Text('Abrir permisos de ubicación'),
                  ),
                const SizedBox(height: 8),
                const Text(
                  'La ubicación se comparte sólo durante tu turno. Si deja de actualizarse, el teléfono deja de participar en la búsqueda.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                ),
              ],
            ],
          ),
        ),
      );
    },
  );
}
