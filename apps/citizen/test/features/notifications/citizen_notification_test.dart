import 'package:civic_report/features/notifications/models/citizen_notification.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses the notification inbox contract', () {
    final notification = CitizenNotification.fromJson({
      'id': '11111111-1111-4111-8111-111111111111',
      'title': 'Report update',
      'body': 'CR-42 is now resolved.',
      'publicId': 'CR-42',
      'reportStatus': 'RESOLVED',
      'createdAt': '2026-10-15T10:00:00Z',
      'readAt': null,
      'data': {'route': '/report-details/CR-42'},
    });

    expect(notification.publicId, 'CR-42');
    expect(notification.route, '/report-details/CR-42');
    expect(notification.createdAt.isUtc, isTrue);
    expect(notification.isRead, isFalse);
  });

  test('markRead returns a read copy without changing notification identity',
      () {
    final notification = CitizenNotification.fromJson({
      'id': '11111111-1111-4111-8111-111111111111',
      'title': 'Report update',
      'body': 'CR-42 is now in progress.',
      'publicId': 'CR-42',
      'reportStatus': 'IN_PROGRESS',
      'createdAt': '2026-10-15T10:00:00Z',
      'readAt': null,
      'data': <String, dynamic>{},
    });

    final read = notification.markRead();
    expect(read.id, notification.id);
    expect(read.isRead, isTrue);
    expect(notification.isRead, isFalse);
  });
}
