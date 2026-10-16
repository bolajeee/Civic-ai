import 'package:civic_report/features/report/services/location_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  final now = DateTime.utc(2026, 10, 16, 12);

  Position position({
    double latitude = 6.5244,
    double longitude = 3.3792,
    double accuracy = 12,
    DateTime? timestamp,
  }) =>
      Position(
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy,
        timestamp: timestamp ?? now,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      );

  group('report location quality policy', () {
    test('accepts a recent precise GPS fix', () {
      expect(isUsableReportPosition(position(), now), isTrue);
    });

    test('rejects stale cached coordinates', () {
      expect(
        isUsableReportPosition(
          position(timestamp: now.subtract(const Duration(minutes: 3))),
          now,
        ),
        isFalse,
      );
    });

    test('rejects fixes whose uncertainty is too large', () {
      expect(
        isUsableReportPosition(position(accuracy: 501), now),
        isFalse,
      );
    });

    test('rejects invalid coordinates and non-finite accuracy', () {
      expect(
        isUsableReportPosition(position(latitude: 91), now),
        isFalse,
      );
      expect(
        isUsableReportPosition(position(accuracy: double.nan), now),
        isFalse,
      );
    });
  });
}
