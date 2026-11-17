import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/router/app_router.dart';
import '../../../core/security/app_lock.dart';
import '../../../core/theme/app_colors_extension.dart';
import '../models/sos_models.dart';
import '../providers/sos_provider.dart';
import '../providers/trusted_contacts_provider.dart';
import '../services/sos_text.dart';

/// Emergency help: call 112, see the nearest relevant responders, and alert
/// trusted contacts with the citizen's location.
///
/// Nothing here dispatches a responder, and the copy never implies otherwise:
/// calling 112 stays the first action on every state of the screen.
class SosScreen extends StatefulWidget {
  const SosScreen({super.key});

  /// How long the SOS button must be held. Long enough that a pocket press
  /// does not send, short enough for someone in distress.
  static const holdDuration = Duration(seconds: 2);

  /// The window to cancel an alert after the hold completes.
  static const countdownSeconds = 5;

  @override
  State<SosScreen> createState() => _SosScreenState();
}

class _SosScreenState extends State<SosScreen> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<SosProvider>().open();
      context.read<TrustedContactsProvider>().load();
    });
  }

  final _scroll = ScrollController();
  String? _shownNotice;

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scroll.dispose();
    super.dispose();
  }

  /// A new notice or error (and the "Text <name>" button with it) sits at the
  /// top, while the citizen is usually scrolled down at the SOS button: bring
  /// it into view.
  void _revealNewMessage(SosProvider sos) {
    final message = sos.error ?? sos.notice;
    if (message == null || message == _shownNotice) {
      _shownNotice = message;
      return;
    }
    _shownNotice = message;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients && _scroll.offset > 0) {
        _scroll.animateTo(0,
            duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  /// Back from the messages app: open the next contact's text.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      context.read<SosProvider>().onAppResumed();
    }
  }

  @override
  Widget build(BuildContext context) {
    final sos = context.watch<SosProvider>();
    final contacts = context.watch<TrustedContactsProvider>();
    _revealNewMessage(sos);

    return Scaffold(
      appBar: AppBar(title: const Text('SOS')),
      body: ListView(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          const _Call112Button(),
          const SizedBox(height: AppConstants.spacingMd),
          if (sos.notice != null) ...[
            _Banner(message: sos.notice!, tone: _Tone.info),
            const SizedBox(height: AppConstants.spacingSm),
          ],
          if (sos.error != null) ...[
            _Banner(message: sos.error!, tone: _Tone.error),
            const SizedBox(height: AppConstants.spacingSm),
          ],
          if (sos.nextTextContact != null) ...[
            _NextText(sos: sos),
            const SizedBox(height: AppConstants.spacingMd),
          ],
          if (sos.phase == SosPhase.active && sos.alert != null)
            _ActiveAlert(sos: sos, contacts: contacts)
          else ...[
            const _SectionTitle('What is happening?'),
            _TypeGrid(selected: sos.type, onSelected: sos.selectType),
            const SizedBox(height: AppConstants.spacingMd),
            _ContactsSummary(contacts: contacts),
            // Update texts only exist when the server sends SMS; otherwise
            // contacts follow the live link in the alert.
            if (contacts.smsEnabled) ...[
              const SizedBox(height: AppConstants.spacingMd),
              _IntervalPicker(
                minutes: sos.intervalMinutes,
                onChanged: sos.setInterval,
              ),
            ],
            const SizedBox(height: AppConstants.spacingLg),
            _HoldToSend(
              sending: sos.phase == SosPhase.sending,
              enabled: sos.phase == SosPhase.idle,
              onSend: () => context
                  .read<SosProvider>()
                  .raise(context.read<TrustedContactsProvider>().contacts),
            ),
          ],
          const SizedBox(height: AppConstants.spacingLg),
          _NearbyHelp(sos: sos),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Call 112
// ---------------------------------------------------------------------------

Future<void> _call(String number) async {
  AppLock.instance.allowNextResume();
  await launchUrl(telUri(number));
}

/// Texts go to one contact at a time; this offers the next one, for when the
/// citizen comes back without the app moving on by itself.
class _NextText extends StatelessWidget {
  const _NextText({required this.sos});

  final SosProvider sos;

  @override
  Widget build(BuildContext context) {
    final contact = sos.nextTextContact!;
    return SizedBox(
      height: 52,
      child: FilledButton.icon(
        onPressed: () => context.read<SosProvider>().textNext(),
        icon: const Icon(Icons.sms_outlined),
        label: Text(
          'Text ${contact.name} '
          '(${sos.nextTextNumber} of ${sos.textTotal})',
        ),
      ),
    );
  }
}

class _Call112Button extends StatelessWidget {
  const _Call112Button();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.error,
          foregroundColor: Colors.white,
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
          ),
        ),
        onPressed: () => _call('112'),
        icon: const Icon(Icons.call),
        label: const Text('Call 112'),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Choosing and sending
// ---------------------------------------------------------------------------

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: AppConstants.spacingSm),
        child: Text(text, style: context.textStyles.label),
      );
}

class _TypeGrid extends StatelessWidget {
  const _TypeGrid({required this.selected, required this.onSelected});

  final EmergencyType selected;
  final ValueChanged<EmergencyType> onSelected;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: AppConstants.spacingSm,
      crossAxisSpacing: AppConstants.spacingSm,
      childAspectRatio: 2.4,
      children: [
        for (final type in EmergencyType.values)
          _TypeTile(
            type: type,
            selected: type == selected,
            onTap: () => onSelected(type),
          ),
      ],
    );
  }
}

class _TypeTile extends StatelessWidget {
  const _TypeTile(
      {required this.type, required this.selected, required this.onTap});

  final EmergencyType type;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final accent = dark ? const Color(0xFFF87171) : AppColors.error;
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected
            ? accent.withValues(alpha: dark ? 0.18 : 0.08)
            : context.colors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppConstants.radiusMd),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppConstants.radiusMd),
              border: Border.all(
                color: selected ? accent : context.colors.inputBorder,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Row(
              children: [
                Icon(type.icon,
                    color: selected ? accent : context.colors.textSecondary),
                const SizedBox(width: AppConstants.spacingSm),
                Expanded(
                  child: Text(
                    type.label,
                    style: context.textStyles.label.copyWith(
                      color: selected
                          ? context.colors.textPrimary
                          : context.colors.textSecondary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ContactsSummary extends StatelessWidget {
  const _ContactsSummary({required this.contacts});

  final TrustedContactsProvider contacts;

  @override
  Widget build(BuildContext context) {
    final list = contacts.contacts;
    final text = list.isEmpty
        ? 'No trusted contacts yet. Add people to text when you send an SOS.'
        : 'Alerts go to ${list.map((c) => c.name).join(', ')}.';
    return Row(
      children: [
        Icon(
          list.isEmpty ? Icons.person_add_alt_1_outlined : Icons.people_outline,
          size: 20,
          color: list.isEmpty
              ? context.colors.statusPendingIcon
              : context.colors.textSecondary,
        ),
        const SizedBox(width: AppConstants.spacingSm),
        Expanded(child: Text(text, style: context.textStyles.bodySmall)),
        TextButton(
          onPressed: () => context.push(AppRoutes.sosContacts),
          child: Text(list.isEmpty ? 'Add' : 'Edit'),
        ),
      ],
    );
  }
}

class _IntervalPicker extends StatelessWidget {
  const _IntervalPicker({required this.minutes, required this.onChanged});

  final int minutes;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionTitle('Location updates to contacts'),
        SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 15, label: Text('Every 15 min')),
            ButtonSegment(value: 30, label: Text('Every 30 min')),
          ],
          selected: {minutes},
          onSelectionChanged: (value) => onChanged(value.first),
          showSelectedIcon: false,
        ),
        const SizedBox(height: AppConstants.spacingXs),
        Text(
          'Sent only when you have moved, for up to 6 hours.',
          style: context.textStyles.bodySmall,
        ),
      ],
    );
  }
}

/// Press and hold for [SosScreen.holdDuration], then a short countdown that
/// can still be cancelled. Both guard against accidental alerts.
class _HoldToSend extends StatefulWidget {
  const _HoldToSend(
      {required this.sending, required this.enabled, required this.onSend});

  final bool sending;
  final bool enabled;
  final VoidCallback onSend;

  @override
  State<_HoldToSend> createState() => _HoldToSendState();
}

class _HoldToSendState extends State<_HoldToSend>
    with SingleTickerProviderStateMixin {
  late final AnimationController _hold = AnimationController(
    vsync: this,
    duration: SosScreen.holdDuration,
  )..addStatusListener((status) {
      if (status == AnimationStatus.completed) _startCountdown();
    });
  Timer? _countdown;
  int? _secondsLeft;

  void _startCountdown() {
    setState(() => _secondsLeft = SosScreen.countdownSeconds);
    _countdown = Timer.periodic(const Duration(seconds: 1), (timer) {
      final left = (_secondsLeft ?? 1) - 1;
      if (left <= 0) {
        timer.cancel();
        setState(() => _secondsLeft = null);
        _hold.reset();
        widget.onSend();
      } else {
        setState(() => _secondsLeft = left);
      }
    });
  }

  void _cancel() {
    _countdown?.cancel();
    _hold.reset();
    setState(() => _secondsLeft = null);
  }

  @override
  void dispose() {
    _countdown?.cancel();
    _hold.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.sending) {
      return const _SendButtonFrame(
        progress: null,
        child: Text('Sending SOS…', style: _buttonText),
      );
    }
    final secondsLeft = _secondsLeft;
    if (secondsLeft != null) {
      return Column(
        children: [
          _SendButtonFrame(
            progress: 1,
            child: Text('Sending in $secondsLeft…', style: _buttonText),
          ),
          TextButton(onPressed: _cancel, child: const Text('Cancel')),
        ],
      );
    }
    return Column(
      children: [
        Listener(
          onPointerDown: widget.enabled ? (_) => _hold.forward() : null,
          onPointerUp: (_) {
            if (_hold.status != AnimationStatus.completed) _hold.reverse();
          },
          onPointerCancel: (_) => _hold.reverse(),
          child: AnimatedBuilder(
            animation: _hold,
            builder: (_, __) => _SendButtonFrame(
              progress: _hold.value,
              child: const Text('Hold to send SOS', style: _buttonText),
            ),
          ),
        ),
        const SizedBox(height: AppConstants.spacingSm),
        Text(
          'Texts your trusted contacts with your live location.',
          style: context.textStyles.bodySmall,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}

const _buttonText =
    TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700);

class _SendButtonFrame extends StatelessWidget {
  const _SendButtonFrame({required this.progress, required this.child});

  /// 0–1 while holding; null for an indeterminate spinner.
  final double? progress;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Hold to send SOS',
      // Outside the clipped pill, so the hold-progress fill stays inside it.
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppConstants.spacingMd),
        child: Container(
          height: 72,
          decoration: BoxDecoration(
            color: const Color(0xFFB91C1C),
            borderRadius: BorderRadius.circular(36),
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (progress != null)
                Positioned.fill(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: FractionallySizedBox(
                      widthFactor: progress!.clamp(0, 1),
                      child: Container(color: const Color(0xFF7F1D1D)),
                    ),
                  ),
                )
              else
                const Positioned(
                  left: 24,
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  ),
                ),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Active alert
// ---------------------------------------------------------------------------

String _clock(DateTime at) {
  final local = at.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

class _ActiveAlert extends StatelessWidget {
  const _ActiveAlert({required this.sos, required this.contacts});

  final SosProvider sos;
  final TrustedContactsProvider contacts;

  @override
  Widget build(BuildContext context) {
    final alert = sos.alert!;
    final saved = contacts.contacts;
    final serverSms = sos.smsEnabled ?? contacts.smsEnabled;
    final queued = sos.contactsQueued;
    final messaged = sos.contactsMessaged;
    final String told;
    if (serverSms && queued > 0) {
      told =
          '$queued trusted contact${queued == 1 ? '' : 's'} alerted by text.';
    } else if (!serverSms && messaged > 0) {
      told = messaged >= saved.length
          ? 'Your alert opened in your messages app for '
              '${messaged == 1 ? 'your contact' : 'all $messaged contacts'}. '
              'Make sure you tapped Send on each.'
          : 'Your alert opened in your messages app for $messaged of '
              '${saved.length} contacts. Make sure you tapped Send.';
    } else if (!serverSms && saved.isNotEmpty) {
      told = 'Send your alert to your trusted contacts from your messages app.';
    } else {
      told =
          'Your SOS is recorded. Add trusted contacts so someone is told next time.';
    }

    final String sharing;
    if (!alert.hasLocation) {
      sharing =
          'Your location was not available, so no location updates will be sent.';
    } else if (sos.updatesEnded || !sos.isSharingLocation) {
      // Covers both the live link and update texts: they stop together.
      sharing = 'Location updates have stopped.';
    } else if (alert.trackingUrl != null && !serverSms) {
      sharing =
          'Your contacts can follow your live location from the link in your alert.';
    } else {
      final last = sos.lastSentAt;
      final next = sos.nextUpdateAfter;
      sharing =
          'Sharing your location every ${alert.updateIntervalMinutes} min when you move.'
          '${last != null ? ' Last sent ${_clock(last)}.' : ''}'
          '${next != null ? ' Next after ${_clock(next)}.' : ''}';
    }

    return Container(
      padding: const EdgeInsets.all(AppConstants.spacingMd),
      decoration: BoxDecoration(
        color: context.colors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: AppColors.error, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.sos_rounded, color: AppColors.error),
              const SizedBox(width: AppConstants.spacingSm),
              Expanded(
                child: Text('SOS active · ${alert.type.label}',
                    style: context.textStyles.label),
              ),
            ],
          ),
          const SizedBox(height: AppConstants.spacingSm),
          Text(told, style: context.textStyles.bodyMedium),
          const SizedBox(height: AppConstants.spacingXs),
          Text(sharing, style: context.textStyles.bodySmall),
          const SizedBox(height: AppConstants.spacingXs),
          Text(
            'No responder has been sent. Call 112 for emergency services.',
            style: context.textStyles.bodySmall,
          ),
          const SizedBox(height: AppConstants.spacingMd),
          // Marking safe is the one way to end the alert and stop sharing
          // location.
          FilledButton.icon(
            onPressed: () => context.read<SosProvider>().markSafe(saved),
            icon: const Icon(Icons.check_circle_outline),
            label: const Text("I'm safe"),
          ),
          if (!serverSms && saved.isNotEmpty)
            OutlinedButton.icon(
              onPressed: () => context.read<SosProvider>().resendLink(saved),
              icon: const Icon(Icons.sms_outlined),
              label: Text(
                  alert.trackingUrl != null ? 'Resend link' : 'Resend alert'),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Help nearby
// ---------------------------------------------------------------------------

class _NearbyHelp extends StatelessWidget {
  const _NearbyHelp({required this.sos});

  final SosProvider sos;

  @override
  Widget build(BuildContext context) {
    final help = sos.nearby;
    final hotlines = help?.hotlines.isNotEmpty == true
        ? help!.hotlines
        : const [Hotline.national];
    final type = sos.alert?.type ?? sos.type;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SectionTitle('Help nearby · ${type.helpLabel}'),
        if (sos.isLocating || sos.isLoadingNearby)
          const Padding(
            padding: EdgeInsets.all(AppConstants.spacingMd),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (sos.here == null)
          _Retry(
            message:
                sos.locationMessage ?? 'Turn on location to see help nearby.',
            onRetry: () => context.read<SosProvider>().locate(),
          )
        else if (sos.nearbyError != null)
          _Retry(
            message: sos.nearbyError!,
            onRetry: () => context.read<SosProvider>().loadNearby(),
          )
        else if (help != null) ...[
          if (help.partial)
            Padding(
              padding: const EdgeInsets.only(bottom: AppConstants.spacingSm),
              child: Text(
                'Live place search is unavailable; showing saved locations only.',
                style: context.textStyles.bodySmall,
              ),
            ),
          if (help.facilities.isEmpty)
            Text('Nothing found within 25 km. Call 112.',
                style: context.textStyles.bodyMedium)
          else ...[
            _FacilityMap(
                here: sos.here!.latitude,
                hereLon: sos.here!.longitude,
                facilities: help.facilities),
            const SizedBox(height: AppConstants.spacingSm),
            for (final facility in help.facilities) _FacilityTile(facility),
          ],
        ],
        const SizedBox(height: AppConstants.spacingMd),
        const _SectionTitle('Hotlines'),
        for (final hotline in hotlines)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.support_agent_outlined),
            title: Text('${hotline.number} · ${hotline.label}'),
            subtitle: Text(hotline.description),
            trailing: IconButton(
              tooltip: 'Call ${hotline.number}',
              icon: const Icon(Icons.call),
              onPressed: () => _call(hotline.number),
            ),
          ),
      ],
    );
  }
}

class _Retry extends StatelessWidget {
  const _Retry({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(child: Text(message, style: context.textStyles.bodySmall)),
          TextButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      );
}

class _FacilityMap extends StatelessWidget {
  const _FacilityMap(
      {required this.here, required this.hereLon, required this.facilities});

  final double here;
  final double hereLon;
  final List<EmergencyFacility> facilities;

  @override
  Widget build(BuildContext context) {
    final points = [
      LatLng(here, hereLon),
      for (final f in facilities.take(8)) LatLng(f.latitude, f.longitude),
    ];
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      child: SizedBox(
        height: 200,
        child: FlutterMap(
          options: MapOptions(
            initialCameraFit: points.length > 1
                ? CameraFit.coordinates(
                    coordinates: points,
                    padding: const EdgeInsets.all(32),
                    maxZoom: 16,
                  )
                : null,
            initialCenter: points.first,
            initialZoom: 14,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.civic_report',
            ),
            MarkerLayer(markers: [
              for (final f in facilities.take(8))
                Marker(
                  point: LatLng(f.latitude, f.longitude),
                  width: 32,
                  height: 32,
                  alignment: Alignment.topCenter,
                  child: const Icon(Icons.location_pin,
                      size: 32, color: AppColors.error),
                ),
              Marker(
                point: points.first,
                width: 20,
                height: 20,
                child: Container(
                  decoration: BoxDecoration(
                    color: context.colors.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                  ),
                ),
              ),
            ]),
            RichAttributionWidget(
              showFlutterMapAttribution: false,
              attributions: [
                TextSourceAttribution(
                  'OpenStreetMap contributors',
                  onTap: () => launchUrl(
                      Uri.parse('https://openstreetmap.org/copyright')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _FacilityTile extends StatelessWidget {
  const _FacilityTile(this.facility);

  final EmergencyFacility facility;

  @override
  Widget build(BuildContext context) {
    final phone = facility.phones.isEmpty ? null : facility.phones.first;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(facility.icon, color: context.colors.textSecondary),
      title: Text(facility.name, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        [
          '${facility.kindLabel} · ${facility.distanceLabel}',
          if (facility.address != null) facility.address!,
        ].join('\n'),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (phone != null)
            IconButton(
              tooltip: 'Call ${facility.name}',
              icon: const Icon(Icons.call_outlined),
              onPressed: () => _call(phone),
            ),
          IconButton(
            tooltip: 'Directions to ${facility.name}',
            icon: const Icon(Icons.directions_outlined),
            onPressed: () {
              AppLock.instance.allowNextResume();
              launchUrl(
                directionsUri(facility.latitude, facility.longitude),
                mode: LaunchMode.externalApplication,
              );
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

enum _Tone { info, error }

class _Banner extends StatelessWidget {
  const _Banner({required this.message, required this.tone});

  final String message;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final color =
        tone == _Tone.error ? AppColors.error : context.colors.primary;
    return Container(
      padding: const EdgeInsets.all(AppConstants.spacingSm),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(message, style: context.textStyles.bodyMedium),
    );
  }
}
