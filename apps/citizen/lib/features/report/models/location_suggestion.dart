/// One result from `GET /api/geo/search` — an address or landmark the citizen
/// can pick when GPS is unavailable or wrong.
class LocationSuggestion {
  const LocationSuggestion({
    required this.id,
    required this.label,
    required this.latitude,
    required this.longitude,
    this.address,
    this.category,
  });

  final String id;

  /// The full formatted place name, e.g. `Computer Village, Ikeja, Lagos`.
  final String label;
  final String? address;
  final double latitude;
  final double longitude;
  final String? category;

  /// Secondary line for the result list. Omitted when it would only repeat
  /// the label.
  String? get subtitle {
    final value = address;
    if (value == null || value.isEmpty || value == label) return null;
    return value;
  }

  factory LocationSuggestion.fromJson(Map<String, dynamic> json) =>
      LocationSuggestion(
        id: json['id'].toString(),
        label: json['label'] as String,
        address: json['address'] as String?,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        category: json['category'] as String?,
      );
}
