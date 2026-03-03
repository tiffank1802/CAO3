"""
API URLs for cao_core
Projects, Events, and Core CAO operations
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from cao_core import views

router = DefaultRouter()
router.register(r'projects', views.ProjectViewSet, basename='project')
router.register(r'sketches', views.SketchViewSet, basename='sketch')
router.register(r'geometries', views.GeometryViewSet, basename='geometry')
router.register(r'assemblies', views.AssemblyViewSet, basename='assembly')

app_name = 'cao_core'

urlpatterns = [
    path('', include(router.urls)),
    path('events/', views.EventListView.as_view(), name='event-list'),
    path('undo/', views.UndoView.as_view(), name='undo'),
    path('redo/', views.RedoView.as_view(), name='redo'),
]
