import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../shared/widgets/primary_button.dart';
import '../providers/report_draft_provider.dart';
import '../widgets/photo_upload_field.dart';

/// "Report an Issue" — the citizen's report form.
///
/// Only the photo step is wired up. Category, Location, Description and Submit
/// are laid out to match the reference design but have no behaviour yet; they
/// are the remaining Phase 2 items (GPS capture, description submission,
/// report-creation API) and will be filled in against this same
/// [ReportDraftProvider].
class ReportIssueScreen extends StatefulWidget {
  const ReportIssueScreen({super.key});

  @override
  State<ReportIssueScreen> createState() => _ReportIssueScreenState();
}

class _ReportIssueScreenState extends State<ReportIssueScreen> {
  @override
  void initState() {
    super.initState();

    // Start from a clean draft. Resetting on entry rather than on exit means
    // abandoning the form drops the staged photos without firing
    // notifyListeners() while the previous screen is being torn down.
    context.read<ReportDraftProvider>().clear();
  }

  void _onSubmit() {
    // The reports API does not exist yet — be explicit rather than leaving a
    // button that silently does nothing.
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Submitting reports arrives with the reports API.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasPhotos = context.select<ReportDraftProvider, bool>(
      (d) => d.photos.isNotEmpty,
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
            const _CategoryGrid(),

            const SizedBox(height: AppConstants.spacingLg),

            const _SectionLabel('Location'),
            const SizedBox(height: AppConstants.spacingSm),
            const _LocationPlaceholder(),

            const SizedBox(height: AppConstants.spacingLg),

            // The working part of the form.
            const PhotoUploadField(),

            const SizedBox(height: AppConstants.spacingLg),

            const _SectionLabel('Description'),
            const SizedBox(height: AppConstants.spacingSm),
            const _DescriptionPlaceholder(),

            const SizedBox(height: AppConstants.spacingXl),

            PrimaryButton(
              label: 'Submit Report',
              onPressed: hasPhotos ? _onSubmit : null,
            ),
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
// Category grid — laid out only, not yet selectable
// ---------------------------------------------------------------------------

const List<({IconData icon, String label})> _categories = [
  (icon: Icons.add_road_outlined, label: 'Pothole'),
  (icon: Icons.water_drop_outlined, label: 'Flooding'),
  (icon: Icons.lightbulb_outline, label: 'Streetlight'),
  (icon: Icons.delete_outline, label: 'Waste'),
  (icon: Icons.water_damage_outlined, label: 'Water Leak'),
  (icon: Icons.more_horiz_rounded, label: 'Other'),
];

class _CategoryGrid extends StatelessWidget {
  const _CategoryGrid();

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: AppConstants.spacingSm,
      crossAxisSpacing: AppConstants.spacingSm,
      childAspectRatio: 1.25,
      children: [
        for (final category in _categories)
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppConstants.radiusMd),
              border: Border.all(color: AppColors.inputBorder),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  category.icon,
                  size: 22,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(height: AppConstants.spacingXs),
                Text(
                  category.label,
                  style: AppTextStyles.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Location placeholder
// ---------------------------------------------------------------------------

class _LocationPlaceholder extends StatelessWidget {
  const _LocationPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppConstants.spacingMd,
        vertical: 14,
      ),
      decoration: BoxDecoration(
        color: AppColors.inputFill,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: AppColors.inputBorder),
      ),
      child: const Row(
        children: [
          Icon(
            Icons.location_on_outlined,
            size: 18,
            color: AppColors.inputIcon,
          ),
          SizedBox(width: AppConstants.spacingSm),
          Expanded(
            // Deliberately not a fake address — GPS capture is the next step.
            child: Text(
              'Your GPS location will be attached to this report',
              style: AppTextStyles.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Description placeholder
// ---------------------------------------------------------------------------

class _DescriptionPlaceholder extends StatelessWidget {
  const _DescriptionPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 96,
      padding: const EdgeInsets.all(AppConstants.spacingMd),
      decoration: BoxDecoration(
        color: AppColors.inputFill,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: AppColors.inputBorder),
      ),
      child: const Text(
        'Provide more details about the issue '
        '(e.g. depth, impact on traffic)…',
        style: AppTextStyles.bodyMedium,
      ),
    );
  }
}
