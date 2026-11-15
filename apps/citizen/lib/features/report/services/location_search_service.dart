import 'package:dio/dio.dart';

import '../../../core/services/api_client.dart';
import '../models/location_suggestion.dart';

/// A failed place search, with a message written to be shown as-is.
class LocationSearchException implements Exception {
  const LocationSearchException(this.message);

  final String message;

  @override
  String toString() => 'LocationSearchException($message)';
}

/// Address/landmark search for the manual location picker.
///
/// Goes through the API's Geoapify proxy rather than calling a geocoder
/// directly, so the provider key stays server-side and results stay limited
/// to Nigeria.
class LocationSearchService {
  LocationSearchService._();
  static final LocationSearchService instance = LocationSearchService._();

  /// The API rejects shorter queries, so the picker does not send them.
  static const int minQueryLength = 2;

  final Dio _dio = ApiClient.instance.dio;

  /// Searches for [query], ranking places near [latitude]/[longitude] first
  /// when both are given.
  Future<List<LocationSuggestion>> search(
    String query, {
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/api/geo/search',
        queryParameters: {
          'q': query.trim(),
          'limit': 6,
          if (latitude != null && longitude != null) ...{
            'lat': latitude,
            'lon': longitude,
          },
        },
      );
      final results = response.data?['results'] as List<dynamic>? ?? const [];
      return results
          .whereType<Map>()
          .map((json) =>
              LocationSuggestion.fromJson(Map<String, dynamic>.from(json)))
          .toList(growable: false);
    } on DioException catch (err) {
      throw LocationSearchException(_messageFor(err));
    }
  }

  String _messageFor(DioException err) {
    final data = err.response?.data;
    if (data is Map && data['error'] is String) return data['error'] as String;

    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.connectionError:
        return 'Could not reach the server. You can still tap the map to drop a pin.';
      default:
        return 'Location search failed. You can still tap the map to drop a pin.';
    }
  }
}
