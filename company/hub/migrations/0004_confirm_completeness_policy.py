from django.db import migrations


def confirm_policy(apps, schema_editor):
    policy = apps.get_model('hub', 'CompletenessPolicy')
    row, _ = policy.objects.get_or_create(pk=1)
    # Apply the owner's confirmed rule without replacing an explicit custom policy.
    if not row.approved_statuses.strip():
        row.approved_statuses = 'approved\napproved w/ comments'
        row.denominator_confirmed = True
        row.enabled = True
        row.save(update_fields=['approved_statuses', 'denominator_confirmed', 'enabled'])


class Migration(migrations.Migration):
    dependencies = [('hub', '0003_alter_uploaddestination_folder_id_and_more')]
    operations = [migrations.RunPython(confirm_policy, migrations.RunPython.noop)]
