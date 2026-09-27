import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../shared/widgets/error_banner.dart';
import '../../../shared/widgets/primary_button.dart';
import '../providers/report_draft_provider.dart';
import '../widgets/category_grid.dart';
import '../widgets/description_field.dart';
import '../widgets/location_field.dart';
import '../widgets/photo_upload_field.dart';

/// "Report an Issue" — the citizen's report form.
///
/// A view over [ReportDraftProvider]: every field writes to the draft and reads
/// back from it, so the report exists in one place and the screen can be
/// rebuilt or left without losing anything.
class ReportIssueScreen extends StatefulWidget {
  const ReportIssueScreen({super.key});

  @override
  State<ReportIssueScreen> createState() => _ReportIssueScreenState();
}

class _ReportIssueScreenState extends State<ReportIssueScreen> {
  @override
  void initState() {
    super.initState();

    final draft = context.read<ReportDraftProvider>();

    // All three of these notify their listeners the moment they run, and doing
    // that from initState would mark an already-built widget dirty mid-build.
    // That is not hypothetical: "Report Issue" pushes without a debounce, so a
    // double tap stacks a second report screen on top of the first, and the
    // `clear()` below would then notify the *first* screen's fields while the
    // second is still being built — a "markNeedsBuild called during build"
    // crash. Deferring costs one frame of the previous draft on re-entry, which
    // is the price of the reset being safe however the screen was reached.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      // Start from a clean draft, so a report abandoned mid-way does not
      // reappear under a new one.
      draft.clear();

      draft.loadCategories();

      // Asked for on entry rather than behind a tap: the permission prompt is
      // better met while the citizen is filling the form than at submit time,
      // and a refusal is not fatal — the field explains and the report goes
      // through without a location.
      draft.captureLocation();
    });
  }

  Future<void> _onSubmit() async {
    final draft = context.read<ReportDraftProvider>();

    final report = await draft.submit();

    // The citizen may have left while the upload was in flight.
    if (!mounted) return;

    if (report == null) {
      // The draft is untouched, so the error banner sits above a form that
      // still holds everything they entered.
      return;
    }

    // Cleared before navigating so returning to this screen does not show the
    // report that was just filed.
    draft.clear();

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Report ${report.publicId} submitted.'),
        behavior: SnackBarBehavior.floating,
      ),
    );

    // Back to where the citizen came from — Home. The history screen is
    // reachable from there and will show this report at the top.
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final canSubmit = context.select<ReportDraftProvider, bool>(
      (d) => d.canSubmit,
    );
    final isSubmitting = context.select<ReportDraftProvider, bool>(
      (d) => d.isSubmitting,
    );
    final error = context.select<ReportDraftProvider, String?>(
      (d) => d.errorMessage,
    );

    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        title: const Text('Report an Issue'),
        centerTitle: true,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppConstants.spacingLg,
            AppConstants.spacingLg,
            AppConstants.spacingLg,
            AppConstants.spacingXl,
          ),
          children: [
            const _SectionLabel('Select Category'),
            const SizedBox(height: AppConstants.spacingSm),
            const CategoryGrid(),

            const SizedBox(height: AppConstants.spacingLg),

            const _SectionLabel('Location'),
            const SizedBox(height: AppConstants.spacingSm),
            const LocationField(),

            const SizedBox(height: AppConstants.spacingLg),

            const PhotoUploadField(),

            const SizedBox(height: AppConstants.spacingLg),

            const _SectionLabel('Description'),
            const SizedBox(height: AppConstants.spacingSm),
            const DescriptionField(),

            if (error != null) ...[
              const SizedBox(height: AppConstants.spacingMd),
              ErrorBanner(message: error),
            ],

            const SizedBox(height: AppConstants.spacingXl),

            PrimaryButton(
              label: 'Submit Report',
              isLoading: isSubmitting,
              onPressed: canSubmit ? _onSubmit : null,
            ),

            // Says why the button is inert, rather than leaving the citizen to
            // work it out from a greyed-out control.
            if (!canSubmit && !isSubmitting) ...[
              const SizedBox(height: AppConstants.spacingSm),
              const _SubmitHint(),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: AppTextStyles.label);
}

// ---------------------------------------------------------------------------
// Submit hint
// ---------------------------------------------------------------------------

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
