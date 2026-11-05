import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Help & Support')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text('How can we help?',
                style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 16),
            const ExpansionTile(
              title: Text('How do I track a report?'),
              children: [
                Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                        'Open My Reports and tap a report to see its latest status.'))
              ],
            ),
            const ExpansionTile(
              title: Text('Can I report without GPS?'),
              children: [
                Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                        'Yes. Location helps route an issue, but a report can still be submitted without it.'))
              ],
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => launchUrl(Uri.parse(
                  'mailto:support@civicai.ng?subject=CivicAI%20support')),
              icon: const Icon(Icons.email_outlined),
              label: const Text('Email support'),
            ),
          ],
        ),
      );
}
