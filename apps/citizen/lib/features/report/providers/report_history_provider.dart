import 'package:flutter/foundation.dart';

import '../models/submitted_report.dart';
import '../services/report_service.dart';

/// The citizen's own report history, as a list.
///
/// Pagination is deliberately absent for now: `fetchHistory` takes a limit, and
/// the screen asks for one page. Infinite scroll belongs with the filters and
/// detail screen that were scoped out of this pass.
class ReportHistoryProvider extends ChangeNotifier {
  final ReportService _service = ReportService.instance;

  List<SubmittedReport> _reports = <SubmittedReport>[];
  bool _isLoading = false;
  String? _errorMessage;
  bool _hasLoaded = false;

  List<SubmittedReport> get reports => List.unmodifiable(_reports);
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  /// True once a load has completed, successfully or not. Distinguishes "no
  /// reports yet" from "we have not looked" — which are different screens.
  bool get hasLoaded => _hasLoaded;

  /// True only when the server said there is nothing, not when a request
  /// failed and the list happens to be empty.
  bool get isEmpty => _hasLoaded && _errorMessage == null && _reports.isEmpty;

  /// The report carrying this citizen-facing id, or null if it is not held.
  ///
  /// Reads the loaded list rather than calling `GET /api/reports/:id`, which
  /// does not exist yet. That is sufficient for the way the app reaches a
  /// detail screen — always by tapping a row that came from this list — but it
  /// does mean a deep link to a report this citizen has not loaded shows
  /// "Report not found" until the list arrives. Called after the list is in
  /// hand, which the route builder guarantees.
  SubmittedReport? byPublicId(String id) {
    for (final report in _reports) {
      if (report.publicId == id) return report;
    }
    return null;
  }

  /// Loads the first page, replacing whatever is held.
  ///
  /// [showSpinner] is false for pull-to-refresh, which has its own indicator —
  /// showing both would blank the list the citizen is looking at.
  Future<void> load({bool showSpinner = true}) async {
    if (_isLoading) return;

    _isLoading = true;
    _errorMessage = null;
    if (showSpinner) notifyListeners();

    try {
      _reports = await _service.fetchHistory();
    } on ReportSubmissionException catch (e) {
      _errorMessage = e.message;
      // The stale list is kept: showing the last known reports alongside an
      // error beats replacing them with an empty screen.
    } catch (_) {
      _errorMessage = 'Could not load your reports. Please try again.';
    } finally {
      _isLoading = false;
      _hasLoaded = true;
      notifyListeners();
    }
  }

  Future<void> refresh() => load(showSpinner: false);
}
