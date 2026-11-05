/// Where a report was observed.
///
/// [accuracy] is the radius of uncertainty in metres, reported by the device.
/// It is preserved rather than discarded because the severity and clustering
/// work in later phases needs to know how much to trust a coordinate — see
/// `docs/database.md`.
class ReportLocation {
  const ReportLocation({
    required this.latitude,
    required this.longitude,
    this.accuracy,
    this.address,
  });

  final double latitude;
  final double longitude;
  final double? accuracy;

  /// Reverse-geocoded human-readable address. Null when the platform geocoder
  /// had nothing for these coordinates or is unavailable — which is common on
  /// emulators and on devices without Play Services. Never treated as an error.
  final String? address;

  /// What to show the citizen. Falls back to raw coordinates so a report with a
  /// fix but no geocoder is still visibly located.
  String get displayLabel {
    final value = address;
    if (value != null && value.isNotEmpty) return value;
    return coordinateLabel;
  }

  String get coordinateLabel =>
      '${latitude.toStringAsFixed(5)}, ${longitude.toStringAsFixed(5)}';

  /// Accuracy rendered for display, e.g. `±12 m`. Null when the device did not
  /// report one.
  String? get accuracyLabel {
    final value = accuracy;
    if (value == null) return null;
    return '±${value.round()} m';
  }

  /// Multipart field values for `POST /api/reports`.
  ///
  /// Strings rather than numbers because every multipart part is text; the API
  /// coerces and validates them.
  Map<String, String> toFormFields() => {
        'latitude': latitude.toString(),
        'longitude': longitude.toString(),
        if (accuracy != null) 'accuracy': accuracy!.toString(),
        if (address != null && address!.isNotEmpty) 'address': address!,
      };

  factory ReportLocation.fromJson(Map<String, dynamic> json) {
    return ReportLocation(
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      accuracy: (json['accuracy'] as num?)?.toDouble(),
      address: json['address'] as String?,
    );
  }
}
