"""
API URLs for operations app
CAD operations (extrude, pocket, fillet, etc.)
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from operations import views

router = DefaultRouter()

app_name = 'operations'

urlpatterns = [
    path('', include(router.urls)),
    path('extrude/', views.ExtrudeView.as_view(), name='extrude'),
    path('pocket/', views.PocketView.as_view(), name='pocket'),
    path('fillet/', views.FilletView.as_view(), name='fillet'),
    path('chamfer/', views.ChamferView.as_view(), name='chamfer'),
    path('pad/', views.PadView.as_view(), name='pad'),
    path('hole/', views.HoleView.as_view(), name='hole'),
]
