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
