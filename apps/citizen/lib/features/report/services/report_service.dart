import 'package:dio/dio.dart';

import '../../../core/services/api_client.dart';
import '../models/report_category.dart';
import '../models/report_location.dart';
import '../models/report_photo.dart';
import '../models/report_summary.dart';
import '../models/submitted_report.dart';

/// Thrown when the API rejects a submission for a reason the citizen can act
/// on — an expired session, a missing photo, a server that is down.
///
/// [message] is written to be shown as-is; the screens do not interpret it.
class ReportSubmissionException implements Exception {
  const ReportSubmissionException(this.message);

  final String message;

  @override
  String toString() => 'ReportSubmissionException($message)';
}

/// The reports API: categories, submission, and the citizen's own history.
///
/// Requests go through [ApiClient] so they inherit the base URL, the bearer
/// token, and the silent-refresh-on-401 behaviour.
class ReportService {
  ReportService._();
  static final ReportService instance = ReportService._();

  final Dio _dio = ApiClient.instance.dio;

  Future<ReportSummary> fetchSummary() async {
    try {
      final response =
          await _dio.get<Map<String, dynamic>>('/api/reports/summary');
      return ReportSummary.fromJson(response.data ?? {});
    } on DioException catch (err) {
      throw ReportSubmissionException(_messageFor(err));
    }
  }

  /// The six seeded categories, in display order.
  ///
  /// Fetched rather than hardcoded because the report carries a server-side
  /// category UUID — the labels alone would not be enough to submit one.
  Future<List<ReportCategory>> fetchCategories() async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/api/reports/categories',
      );

      final categories = response.data?['categories'] as List<dynamic>? ?? [];

      return categories
          .map((json) => ReportCategory.fromJson(json as Map<String, dynamic>))
          .toList(growable: false);
    } on DioException catch (err) {
      throw ReportSubmissionException(_messageFor(err));
    }
  }

  /// Submits a report and its photos as a single multipart request.
  ///
  /// Multipart rather than "upload then create" so the server can commit the
  /// report, its location and its media rows in one transaction: a report can
  /// never exist without the photos it describes.
  ///
  /// [location] is optional. A citizen indoors or underground still has a
  /// hazard worth reporting, so a missing fix is not a failure.
  Future<SubmittedReport> submit({
    required ReportCategory category,
    required List<ReportPhoto> photos,
    String? description,
    ReportLocation? location,
  }) async {
    final trimmedDescription = description?.trim();

    final formData = FormData.fromMap({
      'categoryId': category.id,
      if (trimmedDescription != null && trimmedDescription.isNotEmpty)
        'description': trimmedDescription,
      ...?location?.toFormFields(),
      'photos': [
        for (final photo in photos)
          await MultipartFile.fromFile(
            photo.path,
            filename: photo.name,
            contentType: DioMediaType.parse(photo.mimeType),
          ),
      ],
    });

    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/reports',
        data: formData,
        // Server-side signing and a DB transaction take longer than a plain
        // GET, and the upload itself is bounded by the citizen's connection.
        options: Options(sendTimeout: const Duration(seconds: 60)),
      );

      final report = response.data?['report'] as Map<String, dynamic>?;
      if (report == null) {
        throw const ReportSubmissionException(
          'The server accepted the report but returned no details.',
        );
      }

      // The create endpoint returns a summary — id, public id, status and
      // timestamp. Everything else is filled in from what was just sent, so
      // the caller gets a complete object without a second round trip.
      return SubmittedReport(
        id: report['id'] as String,
        publicId: report['publicId'] as String,
        status: ReportStatus.fromApi(report['status'] as String?),
        category: category,
        photoCount: photos.length,
        description: trimmedDescription,
        submittedAt: report['submittedAt'] != null
            ? DateTime.tryParse(report['submittedAt'] as String)
            : null,
        location: location,
      );
    } on DioException catch (err) {
      throw ReportSubmissionException(_messageFor(err));
    }
  }

  /// The caller's own reports, newest first.
  ///
  /// Scoping to the signed-in citizen is the server's job, not a filter
  /// applied here — see the isolation rule in `docs/architecture.md`.
  Future<List<SubmittedReport>> fetchHistory({
    int limit = 20,
    int offset = 0,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/api/reports',
        queryParameters: {'limit': limit, 'offset': offset},
      );

      final reports = response.data?['reports'] as List<dynamic>? ?? [];

      return reports
          .map((json) => SubmittedReport.fromJson(json as Map<String, dynamic>))
          .toList(growable: false);
    } on DioException catch (err) {
      throw ReportSubmissionException(_messageFor(err));
    }
  }

  /// Turns a transport or HTTP failure into something worth showing a citizen.
  ///
  /// The API's own error body wins when there is one — "At least one photo is
  /// required" is far more useful than "Request failed with status 400".
  String _messageFor(DioException err) {
    final data = err.response?.data;

    if (data is Map && data['error'] != null) {
      final error = data['error'];
      if (error is String) return error;
      // Zod validation failures arrive as a list of issues; the first one is
      // the one worth naming.
      if (error is List && error.isNotEmpty) {
        final first = error.first;
        if (first is Map && first['message'] != null) {
          return first['message'].toString();
        }
      }
    }

    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'The connection timed out. Check your network and try again.';
      case DioExceptionType.connectionError:
        return 'Could not reach the server. Check your connection.';
      case DioExceptionType.cancel:
        return 'The request was cancelled.';
      default:
        final status = err.response?.statusCode;
        if (status == 401) return 'Your session has expired. Sign in again.';
        if (status != null && status >= 500) {
          return 'The server had a problem. Try again in a moment.';
        }
        return 'Something went wrong. Try again.';
    }
  }
}
