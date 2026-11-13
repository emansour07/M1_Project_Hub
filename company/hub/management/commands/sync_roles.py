from django.core.management.base import BaseCommand
from hub.services import sync_roles
class Command(BaseCommand):
    help = 'Load actual roles assigned to members of M1 only.'
    def handle(self,*args,**options): self.stdout.write(f'{sync_roles()} project roles synchronized.')
