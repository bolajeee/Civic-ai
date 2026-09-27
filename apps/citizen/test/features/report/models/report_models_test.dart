import 'package:civic_report/features/report/models/report_category.dart';
import 'package:civic_report/features/report/models/report_location.dart';
import 'package:civic_report/features/report/models/submitted_report.dart';
import 'package:flutter_test/flutter_test.dart';

/// Tests for the report models.
///
/// `SubmittedReport.fromJson` is the one that matters most here: it pins the
/// camelCase field names the API returns. The create endpoint once replied in
/// raw snake_case (`public_id`) while the list endpoint replied in camelCase,
/// which is exactly the kind of drift a test should catch rather than a
/// `TypeError` in the citizen's hands.
void main() {
  group('ReportStatus', () {
    test('maps every status the database enum can hold', () {
      expect(ReportStatus.fromApi('PENDING'), ReportStatus.pending);
      expect(ReportStatus.fromApi('IN_PROGRESS'), ReportStatus.inProgress);
      expect(ReportStatus.fromApi('RESOLVED'), ReportStatus.resolved);
      expect(ReportStatus.fromApi('REJECTED'), ReportStatus.rejected);
    });

    test('an unrecognised status is unknown, not pending', () {
      // A status added server-side must not be mislabelled as Pending — that
      // would tell the citizen nothing has happened when something has.
      expect(ReportStatus.fromApi('ESCALATED'), ReportStatus.unknown);
    });

    test('a missing status is unknown', () {
      expect(ReportStatus.fromApi(null), ReportStatus.unknown);
    });

    test('labels match the reference design', () {
      expect(ReportStatus.pending.label, 'Pending');
      expect(ReportStatus.inProgress.label, 'In Progress');
      expect(ReportStatus.resolved.label, 'Resolved');
    });
  });

  group('ReportLocation', () {
    test('shows the address when there is one', () {
      const location = ReportLocation(
        latitude: 6.5244,
        longitude: 3.3792,
        address: 'Ikeja, Lagos',
      );

      expect(location.displayLabel, 'Ikeja, Lagos');
    });

    test('falls back to coordinates when geocoding found nothing', () {
      const location = ReportLocation(latitude: 6.5244, longitude: 3.3792);

      expect(location.displayLabel, '6.52440, 3.37920');
    });

    test('treats a blank address as no address', () {
      const location = ReportLocation(
        latitude: 6.5244,
        longitude: 3.3792,
        address: '',
      );

      expect(location.displayLabel, '6.52440, 3.37920');
    });

    test('renders accuracy as a rounded radius', () {
      const location = ReportLocation(
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 12.4,
      );

      expect(location.accuracyLabel, '±12 m');
    });

    test('has no accuracy label when the device did not report one', () {
      const location = ReportLocation(latitude: 6.5, longitude: 3.3);

      expect(location.accuracyLabel, isNull);
    });

    test('form fields carry the coordinates as strings', () {
      const location = ReportLocation(latitude: 6.5, longitude: 3.3);

      // Numbers, not strings: every multipart part is text, and the API
      // coerces. Sending them as anything else would arrive mangled.
      expect(location.toFormFields(), {
        'latitude': '6.5',
        'longitude': '3.3',
      });
    });

    test('form fields include accuracy and address only when present', () {
      const location = ReportLocation(
        latitude: 6.5,
        longitude: 3.3,
        accuracy: 8.0,
        address: 'Ikeja, Lagos',
      );

      expect(location.toFormFields(), {
        'latitude': '6.5',
        'longitude': '3.3',
        'accuracy': '8.0',
        'address': 'Ikeja, Lagos',
      });
    });
  });

  group('SubmittedReport.fromJson', () {
    // Exactly the shape GET /api/reports returns.
    final json = <String, dynamic>{
      'id': 'a1b2c3d4-0000-0000-0000-000000000000',
      'publicId': 'CR-1000',
      'status': 'PENDING',
      'description': 'Deep pothole outside the market gate',
      'submittedAt': '2026-09-27T10:30:00.000Z',
      'category': {
        'id': 'c0000000-0000-0000-0000-000000000001',
        'slug': 'POTHOLE',
        'label': 'Pothole',
      },
      'location': {
        'latitude': 6.5244,
        'longitude': 3.3792,
        'accuracy': 12.0,
        'address': 'Ikeja, Lagos',
      },
      'photoCount': 3,
      'thumbnailUrl': 'https://example.test/signed/one.jpg',
    };

    test('parses a complete row', () {
      final report = SubmittedReport.fromJson(json);

      expect(report.publicId, 'CR-1000');
      expect(report.status, ReportStatus.pending);
      expect(report.category.label, 'Pothole');
      expect(report.category.slug, 'POTHOLE');
      expect(report.photoCount, 3);
      expect(report.description, 'Deep pothole outside the market gate');
      expect(report.submittedAt, DateTime.utc(2026, 9, 27, 10, 30));
      expect(report.location?.displayLabel, 'Ikeja, Lagos');
      expect(report.thumbnailUrl, 'https://example.test/signed/one.jpg');
    });

    test('tolerates a report with no location', () {
      final report = SubmittedReport.fromJson({...json, 'location': null});

      expect(report.location, isNull);
      expect(report.publicId, 'CR-1000');
    });

    test('tolerates a report whose thumbnail could not be signed', () {
      final report = SubmittedReport.fromJson({
        ...json,
        'thumbnailUrl': null,
      });

      expect(report.thumbnailUrl, isNull);
    });

    test('an unparseable timestamp becomes null rather than throwing', () {
      final report = SubmittedReport.fromJson({
        ...json,
        'submittedAt': 'not-a-date',
      });

      expect(report.submittedAt, isNull);
    });
  });

  group('ReportCategory', () {
    test('two categories are equal when their ids match', () {
      const a = ReportCategory(id: 'x', slug: 'POTHOLE', label: 'Pothole');
      const b = ReportCategory(id: 'x', slug: 'POTHOLE', label: 'Pothole');

      // Selection is stored by identity, so this equality is what makes the
      // selected tile stay selected across a rebuild.
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('different ids are different categories', () {
      const a = ReportCategory(id: 'x', slug: 'POTHOLE', label: 'Pothole');
      const b = ReportCategory(id: 'y', slug: 'POTHOLE', label: 'Pothole');

      expect(a, isNot(b));
    });
  });
}
