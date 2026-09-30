import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../../shared/widgets/error_banner.dart';
import '../../../shared/widgets/primary_button.dart';
import '../providers/report_draft_provider.dart';
import '../providers/report_history_provider.dart';
import '../providers/report_summary_provider.dart';
import '../widgets/category_grid.dart';
import '../widgets/description_field.dart';
import '../widgets/location_field.dart';
import '../widgets/photo_upload_field.dart';

/// The report form.
///
/// This screen owns the composition and nothing else. Every field it lays out —
/// the category grid, the location readout, the photo strip, the description —
/// is a widget that reads [ReportDraftProvider] itself, and the draft is the
/// single place the report is assembled. An earlier version of this screen held
/// the selections in its own `State` and posted nothing; the two halves could
/// not see each other.
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  @override
  void initState() {
    super.initState();

    // All three of these notify their listeners the moment they run, and doing
    // that from initState would mark an already-built widget dirty mid-build.
    // That is not hypothetical: the "Report Issue" button navigates without a
    // debounce, so a double tap stacks a second report screen on top of the
    // first, and the `clear()` below would then notify the *first* screen's
    // fields while the second is still being built — a "markNeedsBuild called
    // during build" crash. Deferring costs one frame of the previous draft on
    // re-entry, which is the price of the reset being safe however the screen
    // was reached.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final draft = context.read<ReportDraftProvider>();
      // A draft abandoned by leaving last time must not reappear in this one.
      draft.clear();
      draft.loadCategories();
      // Asked for on entry rather than behind a tap: the permission prompt is
      // better met while the citizen is filling the form than at submit time,
      // and a refusal is not fatal — the field explains and the report goes
      // through without a location.
      draft.captureLocation();
    });
  }

  Future<void> _submit() async {
    final draft = context.read<ReportDraftProvider>();
    final history = context.read<ReportHistoryProvider>();

    final created = await draft.submit();
    if (!mounted) return;

    // On failure the provider has written `errorMessage`, which is rendered
    // above the button; the draft is deliberately left intact so nothing the
    // citizen typed or photographed is lost.
    if (created == null) return;

    draft.clear();

    // The new report should be on Home and in History the moment the citizen
    // gets there, rather than only after a pull-to-refresh.
    unawaited(history.refresh());
    unawaited(context.read<ReportSummaryProvider>().refresh(force: true));

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Report ${created.publicId} submitted.'),
        behavior: SnackBarBehavior.floating,
      ),
    );

    context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    final draft = context.watch<ReportDraftProvider>();

    return Scaffold(
      backgroundColor: AppColors.surface,
      // -----------------------------------------------------------------------
      // AppBar
      // -----------------------------------------------------------------------
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(AppRoutes.home);
            }
          },
        ),
        title: const Text('Report an Issue', style: AppTextStyles.heading2),
      ),
      // -----------------------------------------------------------------------
      // Body
      // -----------------------------------------------------------------------
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: AppConstants.spacingLg,
            vertical: AppConstants.spacingMd,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ---------------------------------------------------------------
              // Select Category — the tiles are the server's categories, not a
              // hardcoded list, because the submission carries their UUIDs.
              // ---------------------------------------------------------------
              const Text('Select Category', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              const CategoryGrid(),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Location — optional. A citizen indoors still has a pothole
              // worth reporting, so a failed fix is guidance, not a blocker.
              // ---------------------------------------------------------------
              const Text('Location', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              const LocationField(),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Evidence photo — the citizen's own photo of the issue, not the
              // category icon. PhotoUploadField carries its own "Add Photo"
              // heading and count, so this screen adds no label of its own.
              // ---------------------------------------------------------------
              const PhotoUploadField(),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Description — optional.
              // ---------------------------------------------------------------
              const Text('Description', style: AppTextStyles.label),
              const SizedBox(height: AppConstants.spacingSm),
              const DescriptionField(),

              const SizedBox(height: AppConstants.spacingLg),

              // ---------------------------------------------------------------
              // Submit
              // ---------------------------------------------------------------
              if (draft.errorMessage != null) ...[
                ErrorBanner(message: draft.errorMessage!),
                const SizedBox(height: AppConstants.spacingMd),
              ],

              PrimaryButton(
                label: 'Submit Report',
                isLoading: draft.isSubmitting,
                // Disabled until the two fields the API requires are present:
                // a category and at least one photo.
                onPressed: draft.canSubmit ? _submit : null,
              ),

              // Says why the button is inert, rather than leaving the citizen
              // to work it out from a greyed-out control.
              if (!draft.canSubmit && !draft.isSubmitting) ...[
                const SizedBox(height: AppConstants.spacingSm),
                const _SubmitHint(),
              ],

              const SizedBox(height: AppConstants.spacingMd),
            ],
          ),
        ),
      ),
      // -----------------------------------------------------------------------
      // Bottom navigation — shared AppBottomNav (Report tab active)
      // -----------------------------------------------------------------------
      bottomNavigationBar: AppBottomNav(
        currentTab: NavTab.report,
        onTabSelected: (tab) {
          switch (tab) {
            case NavTab.home:
              context.go(AppRoutes.home);
            case NavTab.report:
              break;
            case NavTab.history:
              context.go(AppRoutes.history);
            case NavTab.profile:
              context.go(AppRoutes.profile);
          }
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Submit hint
// ---------------------------------------------------------------------------

/// Names what is still missing, so a disabled Submit button is explained
/// rather than merely greyed out.
class _SubmitHint extends StatelessWidget {
  const _SubmitHint();

  @override
  Widget build(BuildContext context) {
    final draft = context.watch<ReportDraftProvider>();

    final missing = <String>[
      if (draft.category == null) 'a category',
      if (draft.photos.isEmpty) 'at least one photo',
    ];

    if (missing.isEmpty) return const SizedBox.shrink();

    return Text(
      'Add ${missing.join(' and ')} to submit.',
      style: AppTextStyles.bodySmall,
      textAlign: TextAlign.center,
    );
  }
}
