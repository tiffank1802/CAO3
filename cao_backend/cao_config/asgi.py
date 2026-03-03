"""
ASGI config for cao_config project
Supports both HTTP and WebSocket (Channels)
"""

import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cao_config.settings")

# Get Django ASGI application
django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    # HTTP
    "http": django_asgi_app,
    
    # WebSocket
    "websocket": AuthMiddlewareStack(
        URLRouter([
            # WebSocket routes will be added here
            # path("ws/...", consumer)
        ])
    ),
})
