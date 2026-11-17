import 'package:dio/dio.dart';

import '../../../core/services/api_client.dart';
import '../models/sos_models.dart';

/// A failed SOS request, with a message written to be shown as-is.
class SosException implements Exception {
  const SosException(this.message, {this.isNetwork = false});

  final String message;

  /// The API could not be reached at all — the cue for the offline fallback.
  final bool isNetwork;

  @override
  String toString() => 'SosException($message)';
}

class RaiseAlertResult {
  const RaiseAlertResult({
    required this.alert,
    required this.contactsQueued,
    required this.smsEnabled,
    this.message,
    this.alreadyActive = false,
  });

  final SosAlert alert;
  final int contactsQueued;

  /// False when the server cannot send SMS; the app then offers the phone's
  /// own SMS app with [message].
  final bool smsEnabled;
  final String? message;
  final bool alreadyActive;
}

class MarkSafeResult {
  const MarkSafeResult(
      {required this.alert, required this.smsEnabled, this.message});

  final SosAlert alert;

  /// False when the server did not text contacts; the app then offers the
  /// phone's own SMS app with [message].
  final bool smsEnabled;
  final String? message;
}

class ContactsResult {
  const ContactsResult({required this.contacts, required this.smsEnabled});

  final List<TrustedContact> contacts;

  /// Whether the server texts contacts itself. False means alerts are sent
  /// from the citizen's phone, so SMS update settings do not apply.
  final bool smsEnabled;
}

class LocationUpdateResult {
  const LocationUpdateResult({
    required this.pinged,
    required this.stopUpdates,
    this.nextUpdateAfter,
  });

  final bool pinged;
  final bool stopUpdates;
  final DateTime? nextUpdateAfter;
}

/// `/api/sos`: trusted contacts, help nearby, and alerts.
class SosService {
  SosService._();
  static final SosService instance = SosService._();

  final Dio _dio = ApiClient.instance.dio;

  // --- Contacts --------------------------------------------------------------

  Future<ContactsResult> fetchContacts() => _guard(() async {
        final response =
            await _dio.get<Map<String, dynamic>>('/api/sos/contacts');
        return ContactsResult(
          contacts: (response.data?['contacts'] as List<dynamic>? ?? const [])
              .map((c) => TrustedContact.fromJson(c as Map<String, dynamic>))
              .toList(growable: false),
          // Older servers always sent SMS themselves.
          smsEnabled: response.data?['smsEnabled'] != false,
        );
      });

  Future<TrustedContact> addContact({
    required String name,
    required String phone,
    String? relationship,
  }) =>
      _guard(() async {
        final response = await _dio.post<Map<String, dynamic>>(
          '/api/sos/contacts',
          data: {
            'name': name,
            'phone': phone,
            if (relationship != null && relationship.isNotEmpty)
              'relationship': relationship,
          },
        );
        return TrustedContact.fromJson(
            response.data!['contact'] as Map<String, dynamic>);
      });

  Future<TrustedContact> updateContact(
    String id, {
    required String name,
    required String phone,
    String? relationship,
  }) =>
      _guard(() async {
        final response = await _dio.patch<Map<String, dynamic>>(
          '/api/sos/contacts/$id',
          data: {
            'name': name,
            'phone': phone,
            'relationship': relationship ?? ''
          },
        );
        return TrustedContact.fromJson(
            response.data!['contact'] as Map<String, dynamic>);
      });

  Future<void> deleteContact(String id) =>
      _guard(() => _dio.delete<void>('/api/sos/contacts/$id'));

  // --- Help nearby -----------------------------------------------------------

  Future<NearbyHelp> fetchNearby({
    required EmergencyType type,
    required double latitude,
    required double longitude,
  }) =>
      _guard(() async {
        final response = await _dio.get<Map<String, dynamic>>(
          '/api/sos/nearby',
          queryParameters: {
            'type': type.apiValue,
            'lat': latitude,
            'lon': longitude,
          },
        );
        return NearbyHelp.fromJson(response.data ?? const {});
      });

  // --- Alerts ----------------------------------------------------------------

  Future<SosAlert?> fetchActiveAlert() => _guard(() async {
        final response =
            await _dio.get<Map<String, dynamic>>('/api/sos/alerts/active');
        final alert = response.data?['alert'];
        return alert == null
            ? null
            : SosAlert.fromJson(alert as Map<String, dynamic>);
      });

  Future<RaiseAlertResult> raiseAlert({
    required String clientAlertId,
    required EmergencyType type,
    required int updateIntervalMinutes,
    double? latitude,
    double? longitude,
    double? accuracy,
    String? address,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/sos/alerts',
        data: {
          'clientAlertId': clientAlertId,
          'type': type.apiValue,
          'updateIntervalMinutes': updateIntervalMinutes,
          if (latitude != null && longitude != null) ...{
            'lat': latitude,
            'lon': longitude,
            if (accuracy != null) 'accuracy': accuracy,
          },
          if (address != null && address.isNotEmpty) 'address': address,
        },
      );
      final data = response.data ?? const {};
      return RaiseAlertResult(
        alert: SosAlert.fromJson(data['alert'] as Map<String, dynamic>),
        contactsQueued: (data['contactsQueued'] as num?)?.toInt() ?? 0,
        smsEnabled: data['smsEnabled'] != false,
        message: data['message'] as String?,
      );
    } on DioException catch (err) {
      // An alert already running is not a failure: show that one.
      final data = err.response?.data;
      if (err.response?.statusCode == 409 &&
          data is Map &&
          data['code'] == 'ALERT_ALREADY_ACTIVE' &&
          data['alert'] is Map) {
        return RaiseAlertResult(
          alert: SosAlert.fromJson(Map<String, dynamic>.from(data['alert'])),
          contactsQueued: 0,
          smsEnabled: true,
          alreadyActive: true,
        );
      }
      throw _exceptionFor(err);
    }
  }

  Future<LocationUpdateResult> sendLocation(
    String publicId, {
    required double latitude,
    required double longitude,
    double? accuracy,
    required DateTime recordedAt,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/sos/alerts/$publicId/location',
        data: {
          'lat': latitude,
          'lon': longitude,
          if (accuracy != null) 'accuracy': accuracy,
          'recordedAt': recordedAt.toUtc().toIso8601String(),
        },
      );
      final data = response.data ?? const {};
      return LocationUpdateResult(
        pinged: data['pinged'] == true,
        stopUpdates: data['stopUpdates'] == true,
        nextUpdateAfter:
            DateTime.tryParse(data['nextUpdateAfter']?.toString() ?? ''),
      );
    } on DioException catch (err) {
      // The alert ended elsewhere (e.g. on another device): stop tracking.
      if (err.response?.statusCode == 409 || err.response?.statusCode == 404) {
        return const LocationUpdateResult(pinged: false, stopUpdates: true);
      }
      throw _exceptionFor(err);
    }
  }

  Future<MarkSafeResult> markSafe(String publicId) => _guard(() async {
        final response = await _dio.post<Map<String, dynamic>>(
          '/api/sos/alerts/$publicId/safe',
        );
        final data = response.data!;
        return MarkSafeResult(
          alert: SosAlert.fromJson(data['alert'] as Map<String, dynamic>),
          smsEnabled: data['smsEnabled'] != false,
          message: data['message'] as String?,
        );
      });

  // --- Errors ----------------------------------------------------------------

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (err) {
      throw _exceptionFor(err);
    }
  }

  SosException _exceptionFor(DioException err) {
    switch (err.type) {
      case DioExceptionType.connectionError:
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const SosException(
          'No connection to the server.',
          isNetwork: true,
        );
      default:
        break;
    }
    final data = err.response?.data;
    if (data is Map && data['error'] is String) {
      return SosException(data['error'] as String);
    }
    return const SosException('Something went wrong. Please try again.');
  }
}
