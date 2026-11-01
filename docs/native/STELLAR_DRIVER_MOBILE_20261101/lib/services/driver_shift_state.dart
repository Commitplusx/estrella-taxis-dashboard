import 'taxi_owner_client.dart';

class DriverUnit {
  final int id;
  final String name;
  final String? version, locationVersion;
  final bool active, busy, occupiedByOther, mobileFresh;
  DriverUnit.fromJson(Object? raw)
    : id = ownerRecord(raw)['deviceId'] is int
          ? ownerRecord(raw)['deviceId'] as int
          : 0,
      name = ownerText(ownerRecord(raw)['name']),
      version = ownerRecord(raw)['version'] as String?,
      locationVersion = ownerRecord(raw)['locationVersion'] as String?,
      active = ownerRecord(raw)['active'] == true,
      busy = ownerRecord(raw)['busy'] == true,
      occupiedByOther = ownerRecord(raw)['occupiedByOther'] == true,
      mobileFresh = ownerRecord(raw)['mobileFresh'] == true {
    final row = ownerRecord(raw);
    if (id < 1 ||
        ![
          'active',
          'busy',
          'occupiedByOther',
          'mobileFresh',
        ].every((k) => row[k] is bool) ||
        version != null && !RegExp(r'^[a-f0-9]{32}$').hasMatch(version!) ||
        active &&
            (locationVersion == null ||
                !RegExp(r'^[a-f0-9]{32}$').hasMatch(locationVersion!))) {
      throw const TaxiOwnerException('No pudimos validar tu turno.');
    }
  }
}

class DriverShiftState {
  final TaxiPerson person;
  final List<DriverUnit> units;
  DriverShiftState.fromJson(Map<String, Object?> raw)
    : person = TaxiPerson.fromJson(raw['contact']),
      units = _units(raw['units']);
  static List<DriverUnit> _units(Object? value) {
    if (value is! List<Object?> || value.length > 21) {
      throw const TaxiOwnerException('No pudimos comprobar tus unidades.');
    }
    final units = value.map(DriverUnit.fromJson).toList();
    if (units.map((u) => u.id).toSet().length != units.length ||
        units.where((u) => u.active).length > 1) {
      throw const TaxiOwnerException(
        'Actualiza la asignación de tus turnos con la base.',
      );
    }
    return units;
  }

  DriverUnit? get activeUnit {
    for (final unit in units) {
      if (unit.active) return unit;
    }
    return null;
  }
}
