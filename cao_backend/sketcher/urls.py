"""
API URLs for sketcher app
2D sketch management and constraint solving
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from sketcher import views

router = DefaultRouter()

app_name = 'sketcher'

urlpatterns = [
    path('', include(router.urls)),
    path('validate/', views.ValidateSketchView.as_view(), name='validate-sketch'),
    path('solve-constraints/', views.SolveConstraintsView.as_view(), name='solve-constraints'),
]
