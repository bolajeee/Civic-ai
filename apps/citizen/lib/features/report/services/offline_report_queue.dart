import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/constants/app_constants.dart';
import '../models/pending_report.dart';
import '../models/report_category.dart';
import '../models/report_location.dart';
import '../models/report_photo.dart';
import 'report_service.dart';

typedef ReportSubmitter = Future<void> Function(PendingReport report);

String createClientSubmissionId() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class OfflineReportQueue {
  OfflineReportQueue({
    Future<SharedPreferences> Function()? preferences,
    Future<Directory> Function()? supportDirectory,
    ReportSubmitter? submitter,
  })  : _preferences = preferences ?? SharedPreferences.getInstance,
        _supportDirectory = supportDirectory ?? getApplicationSupportDirectory,
        _submitter = submitter ?? _defaultSubmitter;

  static final OfflineReportQueue instance = OfflineReportQueue();

  final Future<SharedPreferences> Function() _preferences;
  final Future<Directory> Function() _supportDirectory;
  final ReportSubmitter _submitter;
  Future<void> _operationTail = Future<void>.value();

  Future<List<PendingReport>> load() async {
    final prefs = await _preferences();
    final encoded = prefs.getString(AppConstants.keyPendingReports);
    if (encoded == null || encoded.isEmpty) return const [];
    try {
      return (jsonDecode(encoded) as List<dynamic>)
          .map((value) => PendingReport.fromJson(
                Map<String, dynamic>.from(value as Map),
              ))
          .toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  Future<PendingReport> enqueue({
    String? clientSubmissionId,
    required String citizenId,
    required ReportCategory category,
    required List<ReportPhoto> photos,
    String? description,
    ReportLocation? location,
  }) =>
      _serialize(() => _enqueue(
            clientSubmissionId: clientSubmissionId,
            citizenId: citizenId,
            category: category,
            photos: photos,
            description: description,
            location: location,
          ));

  Future<PendingReport> _enqueue({
    String? clientSubmissionId,
    required String citizenId,
    required ReportCategory category,
    required List<ReportPhoto> photos,
    String? description,
    ReportLocation? location,
  }) async {
    final id = clientSubmissionId ?? createClientSubmissionId();
    final root = await _supportDirectory();
    final directory = Directory(
        '${root.path}${Platform.pathSeparator}pending_reports${Platform.pathSeparator}$id');
    await directory.create(recursive: true);

    final durablePhotos = <ReportPhoto>[];
    try {
      for (var index = 0; index < photos.length; index++) {
        final photo = photos[index];
        final extension =
            photo.name.contains('.') ? '.${photo.name.split('.').last}' : '';
        final path =
            '${directory.path}${Platform.pathSeparator}photo_$index$extension';
        await File(photo.path).copy(path);
        durablePhotos.add(ReportPhoto(
          file: XFile(path),
          name: photo.name,
          sizeBytes: photo.sizeBytes,
          mimeType: photo.mimeType,
          width: photo.width,
          height: photo.height,
        ));
      }
    } catch (_) {
      if (await directory.exists()) await directory.delete(recursive: true);
      rethrow;
    }

    final pending = PendingReport(
      id: id,
      citizenId: citizenId,
      category: category,
      photos: durablePhotos,
      createdAt: DateTime.now().toUtc(),
      description: description?.trim(),
      location: location,
    );
    await _save([...await load(), pending]);
    return pending;
  }

  Future<int> countFor(String? citizenId) async {
    if (citizenId == null) return 0;
    return (await load())
        .where((report) => report.citizenId == citizenId)
        .length;
  }

  Future<int> sync(String citizenId) => _serialize(() => _sync(citizenId));

  Future<int> _sync(String citizenId) async {
    var synced = 0;
    final queue = [...await load()];
    for (var index = 0; index < queue.length; index++) {
      final pending = queue[index];
      if (pending.citizenId != citizenId) continue;
      if (!pending.photos.every((photo) => File(photo.path).existsSync())) {
        queue[index] = pending.failed('A queued photo is no longer available.');
        continue;
      }
      try {
        await _submitter(pending);
        queue.removeAt(index--);
        synced++;
        final directory = File(pending.photos.first.path).parent;
        if (await directory.exists()) await directory.delete(recursive: true);
      } on ReportSubmissionException catch (error) {
        queue[index] = pending.failed(error.message);
        if (error.isRetryable) break;
      } catch (error) {
        queue[index] = pending.failed(error.toString());
        break;
      }
    }
    await _save(queue);
    return synced;
  }

  Future<T> _serialize<T>(Future<T> Function() operation) {
    final result = Completer<T>();
    _operationTail = _operationTail.then((_) async {
      try {
        result.complete(await operation());
      } catch (error, stackTrace) {
        result.completeError(error, stackTrace);
      }
    });
    return result.future;
  }

  Future<void> _save(List<PendingReport> queue) async {
    final prefs = await _preferences();
    await prefs.setString(
      AppConstants.keyPendingReports,
      jsonEncode(queue.map((report) => report.toJson()).toList()),
    );
  }

  static Future<void> _defaultSubmitter(PendingReport report) async {
    await ReportService.instance.submit(
      clientSubmissionId: report.id,
      category: report.category,
      photos: report.photos,
      description: report.description,
      location: report.location,
    );
  }
}
