import 'dart:async';
import 'dart:io';

import 'package:civic_report/features/report/models/report_category.dart';
import 'package:civic_report/features/report/models/report_photo.dart';
import 'package:civic_report/features/report/services/offline_report_queue.dart';
import 'package:civic_report/features/report/services/report_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  late Directory temporaryDirectory;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    temporaryDirectory = await Directory.systemTemp.createTemp('civic_queue_');
  });

  tearDown(() async {
    if (await temporaryDirectory.exists()) {
      await temporaryDirectory.delete(recursive: true);
    }
  });

  Future<ReportPhoto> photo(String name) async {
    final file =
        File('${temporaryDirectory.path}${Platform.pathSeparator}$name');
    await file.writeAsBytes([1, 2, 3, 4]);
    return ReportPhoto(
      file: XFile(file.path),
      name: name,
      sizeBytes: 4,
      mimeType: 'image/jpeg',
      width: 10,
      height: 10,
    );
  }

  test('copies photos into durable storage and restores queue metadata',
      () async {
    final queue = OfflineReportQueue(
      supportDirectory: () async => temporaryDirectory,
      submitter: (_) async {},
    );
    final original = await photo('capture.jpg');
    final pending = await queue.enqueue(
      citizenId: 'citizen-a',
      category:
          const ReportCategory(id: '1', slug: 'pothole', label: 'Pothole'),
      photos: [original],
      description: 'Deep pothole',
    );

    expect(pending.photos.single.path, isNot(original.path));
    expect(await File(pending.photos.single.path).exists(), isTrue);
    final restored = await queue.load();
    expect(restored.single.citizenId, 'citizen-a');
    expect(restored.single.description, 'Deep pothole');
    expect(restored.single.photos.single.name, 'capture.jpg');
  });

  test('sync is account-scoped and removes successful durable files', () async {
    final submitted = <String>[];
    final queue = OfflineReportQueue(
      supportDirectory: () async => temporaryDirectory,
      submitter: (report) async => submitted.add(report.citizenId),
    );
    const category = ReportCategory(id: '1', slug: 'pothole', label: 'Pothole');
    final first = await queue.enqueue(
      citizenId: 'citizen-a',
      category: category,
      photos: [await photo('a.jpg')],
    );
    await queue.enqueue(
      citizenId: 'citizen-b',
      category: category,
      photos: [await photo('b.jpg')],
    );

    expect(await queue.sync('citizen-a'), 1);
    expect(submitted, ['citizen-a']);
    expect(await File(first.photos.single.path).exists(), isFalse);
    expect(await queue.countFor('citizen-a'), 0);
    expect(await queue.countFor('citizen-b'), 1);
  });

  test('retryable failures stay queued with attempt details', () async {
    final queue = OfflineReportQueue(
      supportDirectory: () async => temporaryDirectory,
      submitter: (_) async => throw const ReportSubmissionException(
        'offline',
        isRetryable: true,
      ),
    );
    await queue.enqueue(
      citizenId: 'citizen-a',
      category:
          const ReportCategory(id: '1', slug: 'pothole', label: 'Pothole'),
      photos: [await photo('capture.jpg')],
    );

    expect(await queue.sync('citizen-a'), 0);
    final pending = (await queue.load()).single;
    expect(pending.attempts, 1);
    expect(pending.lastError, 'offline');
  });

  test('enqueue cannot be lost while an existing report is syncing', () async {
    final uploadStarted = Completer<void>();
    final finishUpload = Completer<void>();
    final queue = OfflineReportQueue(
      supportDirectory: () async => temporaryDirectory,
      submitter: (_) async {
        uploadStarted.complete();
        await finishUpload.future;
      },
    );
    const category = ReportCategory(id: '1', slug: 'pothole', label: 'Pothole');
    await queue.enqueue(
      citizenId: 'citizen-a',
      category: category,
      photos: [await photo('first.jpg')],
    );

    final sync = queue.sync('citizen-a');
    await uploadStarted.future;
    final enqueue = queue.enqueue(
      citizenId: 'citizen-a',
      category: category,
      photos: [await photo('second.jpg')],
    );
    finishUpload.complete();
    await Future.wait([sync, enqueue]);

    final pending = await queue.load();
    expect(pending, hasLength(1));
    expect(pending.single.photos.single.name, 'second.jpg');
  });
}
