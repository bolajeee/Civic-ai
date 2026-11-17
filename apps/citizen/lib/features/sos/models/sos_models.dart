import 'package:flutter/material.dart';

/// The kinds of emergency SOS knows how to find help for. The API value is
/// what `/api/sos` expects; the copy is what the citizen sees.
enum EmergencyType {
  medical('MEDICAL', 'Medical', Icons.medical_services_outlined,
      'Nearest hospitals and clinics'),
  security('SECURITY', 'Security', Icons.local_police_outlined,
      'Police and civil defence'),
  fire('FIRE', 'Fire', Icons.local_fire_department_outlined,
      'Nearest fire stations'),
  accident('ACCIDENT', 'Road accident', Icons.car_crash_outlined,
      'Hospitals, police and FRSC');

  const EmergencyType(this.apiValue, this.label, this.icon, this.helpLabel);

  final String apiValue;
  final String label;
  final IconData icon;
  final String helpLabel;

  static EmergencyType fromApi(Object? value) => values.firstWhere(
        (type) => type.apiValue == value,
        orElse: () => medical,
      );
}

class TrustedContact {
  const TrustedContact({
    required this.id,
    required this.name,
    required this.phone,
    this.relationship,
  });

  final String id;
  final String name;

  /// E.164, as normalised by the API.
  final String phone;
  final String? relationship;

  factory TrustedContact.fromJson(Map<String, dynamic> json) => TrustedContact(
        id: json['id'] as String,
        name: json['name'] as String,
        phone: json['phone'] as String,
        relationship: json['relationship'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'phone': phone,
        if (relationship != null) 'relationship': relationship,
      };
}

class EmergencyFacility {
  const EmergencyFacility({
    required this.id,
    required this.name,
    required this.kind,
    required this.latitude,
    required this.longitude,
    required this.distanceMeters,
    this.agency,
    this.address,
    this.phones = const [],
    this.curated = false,
  });

  final String id;
  final String name;

  /// POLICE, FIRE, HOSPITAL or PARAMILITARY.
  final String kind;
  final String? agency;
  final String? address;
  final List<String> phones;
  final double latitude;
  final double longitude;
  final int distanceMeters;

  /// From the hand-checked facility list rather than OpenStreetMap.
  final bool curated;

  String get distanceLabel => formatDistance(distanceMeters);

  String get kindLabel => switch (kind) {
        'POLICE' => 'Police',
        'FIRE' => 'Fire service',
        'HOSPITAL' => 'Hospital',
        'PARAMILITARY' => agency ?? 'Paramilitary',
        _ => kind,
      };

  IconData get icon => switch (kind) {
        'POLICE' || 'PARAMILITARY' => Icons.local_police_outlined,
        'FIRE' => Icons.local_fire_department_outlined,
        _ => Icons.local_hospital_outlined,
      };

  factory EmergencyFacility.fromJson(Map<String, dynamic> json) =>
      EmergencyFacility(
        id: json['id'].toString(),
        name: json['name'] as String,
        kind: json['kind'] as String,
        agency: json['agency'] as String?,
        address: json['address'] as String?,
        phones: (json['phones'] as List<dynamic>? ?? const [])
            .map((p) => p.toString())
            .toList(growable: false),
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        distanceMeters: (json['distanceMeters'] as num).round(),
        curated: json['source'] == 'CURATED',
      );
}

String formatDistance(int meters) {
  if (meters < 1000) return '${(meters / 10).round() * 10} m';
  final km = meters / 1000;
  return '${km < 10 ? km.toStringAsFixed(1) : km.round()} km';
}

class Hotline {
  const Hotline({
    required this.label,
    required this.number,
    required this.description,
  });

  final String label;
  final String number;
  final String description;

  factory Hotline.fromJson(Map<String, dynamic> json) => Hotline(
        label: json['label'] as String,
        number: json['number'] as String,
        description: json['description'] as String? ?? '',
      );

  /// Always available, even before (or without) a network response.
  static const national = Hotline(
    label: 'National Emergency',
    number: '112',
    description: 'Toll-free from any network.',
  );
}

class NearbyHelp {
  const NearbyHelp({
    required this.facilities,
    required this.hotlines,
    this.partial = false,
  });

  final List<EmergencyFacility> facilities;
  final List<Hotline> hotlines;

  /// True when the live place search failed and only the curated list is shown.
  final bool partial;

  factory NearbyHelp.fromJson(Map<String, dynamic> json) => NearbyHelp(
        facilities: (json['facilities'] as List<dynamic>? ?? const [])
            .map((f) => EmergencyFacility.fromJson(f as Map<String, dynamic>))
            .toList(growable: false),
        hotlines: (json['hotlines'] as List<dynamic>? ?? const [])
            .map((h) => Hotline.fromJson(h as Map<String, dynamic>))
            .toList(growable: false),
        partial: json['partial'] == true,
      );
}

class SosAlert {
  const SosAlert({
    required this.publicId,
    required this.type,
    required this.status,
    required this.updateIntervalMinutes,
    required this.createdAt,
    this.hasLocation = false,
    this.lastPingedAt,
    this.pingCount = 0,
    this.updatesStoppedAt,
    this.trackingUrl,
  });

  final String publicId;
  final EmergencyType type;
  final String status;
  final int updateIntervalMinutes;
  final DateTime createdAt;
  final bool hasLocation;
  final DateTime? lastPingedAt;
  final int pingCount;
  final DateTime? updatesStoppedAt;

  /// Private live-location page for trusted contacts; null for alerts raised
  /// before tracking links existed.
  final String? trackingUrl;

  bool get isActive => status == 'ACTIVE';
  bool get updatesStopped => updatesStoppedAt != null;

  factory SosAlert.fromJson(Map<String, dynamic> json) => SosAlert(
        publicId: json['publicId'] as String,
        type: EmergencyType.fromApi(json['type']),
        status: json['status'] as String,
        updateIntervalMinutes:
            (json['updateIntervalMinutes'] as num?)?.toInt() ?? 30,
        createdAt: DateTime.parse(json['createdAt'] as String),
        hasLocation: json['latitude'] != null,
        lastPingedAt: DateTime.tryParse(json['lastPingedAt']?.toString() ?? ''),
        pingCount: (json['pingCount'] as num?)?.toInt() ?? 0,
        updatesStoppedAt:
            DateTime.tryParse(json['updatesStoppedAt']?.toString() ?? ''),
        trackingUrl: json['trackingUrl'] as String?,
      );
}
