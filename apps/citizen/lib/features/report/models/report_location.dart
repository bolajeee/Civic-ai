/// Where a report was observed.
///
/// [accuracy] is the radius of uncertainty in metres, reported by the device.
/// It is preserved rather than discarded because the severity and clustering
/// work in later phases needs to know how much to trust a coordinate — see
/// `docs/database.md`.
enum ReportLocationSource {
  deviceGps('DEVICE_GPS'),
  cachedGps('CACHED_GPS'),
  userAdjusted('USER_ADJUSTED'),
  unknown('UNKNOWN');

  const ReportLocationSource(this.apiValue);
  final String apiValue;

  factory ReportLocationSource.fromApi(Object? value) => values.firstWhere(
        (source) => source.apiValue == value,
        orElse: () => unknown,
      );
}

class ReportLocation {
  const ReportLocation({
    required this.latitude,
    required this.longitude,
    this.accuracy,
    this.address,
    this.source = ReportLocationSource.unknown,
    this.capturedAt,
  });

  final double latitude;
  final double longitude;
  final double? accuracy;
  final ReportLocationSource source;
  final DateTime? capturedAt;

  /// Reverse-geocoded human-readable address. Null when the platform geocoder
  /// had nothing for these coordinates or is unavailable — which is common on
  /// emulators and on devices without Play Services. Never treated as an error.
  final String? address;

  ReportLocation adjusted(
          {required double latitude, required double longitude}) =>
      ReportLocation(
        latitude: latitude,
        longitude: longitude,
        // The reported radius only describes the original GPS fix. Keeping it
        // after the citizen moves the pin would claim accuracy we do not have.
        accuracy: null,
        source: ReportLocationSource.userAdjusted,
        capturedAt: capturedAt,
      );

  ReportLocation withAddress(String? value) => ReportLocation(
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
        address: value,
        source: source,
        capturedAt: capturedAt,
      );

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
      source: ReportLocationSource.fromApi(json['source']),
      capturedAt: DateTime.tryParse(json['capturedAt']?.toString() ?? ''),
    );
  }

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        if (accuracy != null) 'accuracy': accuracy,
        if (address != null) 'address': address,
        'source': source.apiValue,
        if (capturedAt != null)
          'capturedAt': capturedAt!.toUtc().toIso8601String(),
      };
}
