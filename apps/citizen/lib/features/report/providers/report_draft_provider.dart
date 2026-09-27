import 'package:flutter/foundation.dart';

import '../../../core/constants/app_constants.dart';
import '../models/report_category.dart';
import '../models/report_location.dart';
import '../models/report_photo.dart';
import '../models/submitted_report.dart';
import '../services/location_service.dart';
import '../services/photo_picker_service.dart';
import '../services/report_service.dart';

/// Holds the citizen's in-progress report, from the first photo to submission.
///
/// One draft object owns every field so the screen stays a view over this state
/// rather than a second place where the report is assembled. Nothing here is
/// persisted: a report abandoned mid-way is dropped, which is what the citizen
/// asked for by leaving.
class ReportDraftProvider extends ChangeNotifier {
  final PhotoPickerService _photoPicker = PhotoPickerService.instance;
  final LocationService _locationService = LocationService.instance;
  final ReportService _reports = ReportService.instance;

  // --- Photos ---------------------------------------------------------------
  List<ReportPhoto> _photos = <ReportPhoto>[];
  bool _isPicking = false;

  // --- Category / description / location ------------------------------------
  List<ReportCategory> _categories = <ReportCategory>[];
  bool _isLoadingCategories = false;
  String? _categoriesError;
  ReportCategory? _category;
  String _description = '';
  ReportLocation? _location;
  bool _isLocating = false;
  LocationFailure? _locationFailure;

  // --- Submission -----------------------------------------------------------
  bool _isSubmitting = false;

  /// A failed submission. Rendered by the screen, above the submit button.
  String? _errorMessage;

  /// A failed photo pick, or a refused camera permission. Kept separate from
  /// [_errorMessage] so the photo section reports its own failures in place —
  /// sharing one field would render a submission error under the photos as
  /// well as above the button.
  String? _photoErrorMessage;
  bool _permissionDenied = false;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /// Read-only view of the staged photos, in the order they were added.
  List<ReportPhoto> get photos => List.unmodifiable(_photos);
  int get photoCount => _photos.length;
  bool get isPicking => _isPicking;

  ReportCategory? get category => _category;

  /// The selectable categories, straight from the server so their identifiers
  /// are the ones submissions must carry.
  List<ReportCategory> get categories => List.unmodifiable(_categories);
  bool get isLoadingCategories => _isLoadingCategories;
  String? get categoriesError => _categoriesError;
  bool get hasCategories => _categories.isNotEmpty;

  String get description => _description;

  /// Null when no fix was captured — either it has not been attempted yet, or
  /// it failed. [locationFailure] says which.
  ReportLocation? get location => _location;
  bool get isLocating => _isLocating;
  LocationFailure? get locationFailure => _locationFailure;

  bool get isSubmitting => _isSubmitting;

  /// A failed submission, for the screen to show near the submit button.
  String? get errorMessage => _errorMessage;

  /// A failed photo pick, for the photo section to show in place.
  String? get photoErrorMessage => _photoErrorMessage;

  /// True when the last camera attempt failed because access was refused.
  /// The screen uses this to offer "Open Settings" as the remedy.
  bool get permissionDenied => _permissionDenied;

  int get maxPhotos => AppConstants.maxReportPhotos;

  /// Drives whether the "Add more photos" affordance is shown. Guarded here as
  /// well as in the UI so the cap holds even if a caller bypasses the widget.
  bool get canAddMore => _photos.length < AppConstants.maxReportPhotos;

  /// The two fields the API requires. Location is deliberately absent: a
  /// citizen who cannot get a fix must still be able to report a hazard.
  bool get canSubmit =>
      _category != null && _photos.isNotEmpty && !_isSubmitting;

  // ---------------------------------------------------------------------------
  // Photos
  // ---------------------------------------------------------------------------

  Future<void> takePhoto() => _pick(_photoPicker.pickFromCamera);

  Future<void> chooseFromGallery() => _pick(_photoPicker.pickFromGallery);

  /// Removes the photo at [index] from the draft.
  void removePhoto(int index) {
    if (index < 0 || index >= _photos.length) return;
    _photos.removeAt(index);
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Category, description, location
  // ---------------------------------------------------------------------------

  /// Loads the categories the citizen can choose from.
  ///
  /// Fetched once per visit rather than cached across sessions: the list is six
  /// rows, and a stale category id would fail the submission server-side.
  Future<void> loadCategories() async {
    if (_isLoadingCategories) return;

    _isLoadingCategories = true;
    _categoriesError = null;
    notifyListeners();

    try {
      _categories = await _reports.fetchCategories();
    } on ReportSubmissionException catch (e) {
      _categoriesError = e.message;
    } catch (_) {
      _categoriesError = 'Could not load categories. Pull down to retry.';
    } finally {
      _isLoadingCategories = false;
      notifyListeners();
    }
  }

  void selectCategory(ReportCategory value) {
    if (_category == value) return;
    _category = value;
    notifyListeners();
  }

  /// Called on every keystroke, so it notifies only when the value changed.
  void setDescription(String value) {
    if (_description == value) return;
    _description = value;
    notifyListeners();
  }

  /// Takes a GPS fix and, where the platform geocoder can, an address for it.
  ///
  /// A failure is recorded rather than thrown: the screen shows it as guidance
  /// and the report can still be submitted without a location.
  Future<void> captureLocation() async {
    if (_isLocating) return;

    _isLocating = true;
    _locationFailure = null;
    notifyListeners();

    try {
      _location = await _locationService.capture();
    } on LocationException catch (e) {
      _locationFailure = e.failure;
      _location = null;
    } catch (_) {
      _locationFailure = LocationFailure.unavailable;
      _location = null;
    } finally {
      _isLocating = false;
      notifyListeners();
    }
  }

  /// Opens the OS settings page that unblocks a refused location permission.
  Future<void> openLocationSettings() async {
    final failure = _locationFailure;
    if (failure == LocationFailure.serviceDisabled) {
      await _locationService.openLocationSettings();
    } else {
      await _locationService.openSettings();
    }
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  /// Posts the draft. Returns the created report, or null if it failed — in
  /// which case [errorMessage] explains why and the draft is left intact so
  /// nothing the citizen entered is lost.
  Future<SubmittedReport?> submit() async {
    final category = _category;
    if (category == null || _photos.isEmpty || _isSubmitting) return null;

    _isSubmitting = true;
    _errorMessage = null;
    notifyListeners();

    try {
      return await _reports.submit(
        category: category,
        // A snapshot, not the live list. Building the multipart body awaits a
        // file read per photo, and the remove buttons are still tappable while
        // that runs — iterating `_photos` across those awaits would throw a
        // ConcurrentModificationError if one were removed mid-upload.
        photos: List<ReportPhoto>.of(_photos),
        description: _description,
        location: _location,
      );
    } on ReportSubmissionException catch (e) {
      _errorMessage = e.message;
      return null;
    } catch (_) {
      _errorMessage = 'Could not submit the report. Please try again.';
      return null;
    } finally {
      _isSubmitting = false;
      notifyListeners();
    }
  }

  // ---------------------------------------------------------------------------
  // Resetting
  // ---------------------------------------------------------------------------

  /// Drops the whole draft — photos, category, description and location.
  ///
  /// Called when the citizen enters the report screen and again after a
  /// successful submission. No files are deleted: the photos live in the app's
  /// cache directory, which the OS reclaims on its own. Dropping the references
  /// is all that is needed.
  void clear() {
    if (!_hasAnything) return;

    _photos = <ReportPhoto>[];
    _category = null;
    _description = '';
    _location = null;
    _locationFailure = null;
    _errorMessage = null;
    _photoErrorMessage = null;
    _permissionDenied = false;
    notifyListeners();
  }

  void clearError() {
    if (_errorMessage == null &&
        _photoErrorMessage == null &&
        !_permissionDenied) {
      return;
    }
    _errorMessage = null;
    _photoErrorMessage = null;
    _permissionDenied = false;
    notifyListeners();
  }

  bool get _hasAnything =>
      _photos.isNotEmpty ||
      _category != null ||
      _description.isNotEmpty ||
      _location != null ||
      _locationFailure != null ||
      _errorMessage != null ||
      _photoErrorMessage != null ||
      _permissionDenied;

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  Future<void> _pick(Future<ReportPhoto?> Function() pick) async {
    if (!canAddMore || _isPicking) return;

    _isPicking = true;
    _photoErrorMessage = null;
    _permissionDenied = false;
    notifyListeners();

    try {
      final photo = await pick();
      // null means the citizen cancelled — leave the draft untouched and show
      // no error, because nothing went wrong.
      if (photo != null) _photos.add(photo);
    } on PhotoPermissionException catch (e) {
      _permissionDenied = true;
      _photoErrorMessage = e.permanentlyDenied
          ? 'Camera access is blocked. Enable it in Settings to take photos.'
          : 'Camera access was denied. Enable it in Settings to take photos.';
    } catch (_) {
      _photoErrorMessage = 'Could not open the camera. Please try again.';
    } finally {
      _isPicking = false;
      notifyListeners();
    }
  }
}
