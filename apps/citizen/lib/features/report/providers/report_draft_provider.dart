import 'package:flutter/foundation.dart';

import '../../../core/constants/app_constants.dart';
import '../models/report_photo.dart';
import '../services/photo_picker_service.dart';

/// Holds the citizen's in-progress report.
///
/// Phase 2 currently owns the photo step; category, location and description
/// will join this same draft as their own progress.md items land, so the whole
/// submission is assembled in one place before it is posted.
class ReportDraftProvider extends ChangeNotifier {
  final _service = PhotoPickerService.instance;

  List<ReportPhoto> _photos = <ReportPhoto>[];
  bool _isPicking = false;
  String? _errorMessage;
  bool _permissionDenied = false;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /// Read-only view of the staged photos, in the order they were added.
  List<ReportPhoto> get photos => List.unmodifiable(_photos);
  int get photoCount => _photos.length;
  bool get isPicking => _isPicking;
  String? get errorMessage => _errorMessage;

  /// True when the last camera attempt failed because access was refused.
  /// The screen uses this to offer "Open Settings" as the remedy.
  bool get permissionDenied => _permissionDenied;

  int get maxPhotos => AppConstants.maxReportPhotos;

  /// Drives whether the "Add more photos" affordance is shown. Guarded here as
  /// well as in the UI so the cap holds even if a caller bypasses the widget.
  bool get canAddMore => _photos.length < AppConstants.maxReportPhotos;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  Future<void> takePhoto() => _pick(_service.pickFromCamera);

  Future<void> chooseFromGallery() => _pick(_service.pickFromGallery);

  /// Removes the photo at [index] from the draft.
  void removePhoto(int index) {
    if (index < 0 || index >= _photos.length) return;
    _photos.removeAt(index);
    notifyListeners();
  }

  /// Drops every staged photo. Called when the citizen abandons the report.
  ///
  /// No files are deleted: the photos live in the app's cache directory, which
  /// the OS reclaims on its own. Dropping the references is all that is needed.
  void clear() {
    if (_photos.isEmpty && _errorMessage == null) return;
    _photos = <ReportPhoto>[];
    _errorMessage = null;
    _permissionDenied = false;
    notifyListeners();
  }

  void clearError() {
    if (_errorMessage == null && !_permissionDenied) return;
    _errorMessage = null;
    _permissionDenied = false;
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  Future<void> _pick(Future<ReportPhoto?> Function() pick) async {
    if (!canAddMore || _isPicking) return;

    _isPicking = true;
    _errorMessage = null;
    _permissionDenied = false;
    notifyListeners();

    try {
      final photo = await pick();
      // null means the citizen cancelled — leave the draft untouched and show
      // no error, because nothing went wrong.
      if (photo != null) _photos.add(photo);
    } on PhotoPermissionException catch (e) {
      _permissionDenied = true;
      _errorMessage = e.permanentlyDenied
          ? 'Camera access is blocked. Enable it in Settings to take photos.'
          : 'Camera access was denied. Enable it in Settings to take photos.';
    } catch (_) {
      _errorMessage = 'Could not open the camera. Please try again.';
    } finally {
      _isPicking = false;
      notifyListeners();
    }
  }
}
