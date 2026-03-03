"""
Views for cao_core app
REST API for Projects, Sketches, Geometries, and Assemblies
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.views import APIView
from rest_framework.generics import ListAPIView
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from rest_framework_simplejwt.tokens import RefreshToken
from cao_core.models import Project, Sketch, Geometry, Assembly, EventStore
from cao_core.services import EventStoreService
from cao_core.serializers import UserSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    """
    CRUD operations for CAO Projects
    Only owners can view/edit their projects
    """
    queryset = Project.objects.all()
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        return Project.objects.filter(owner=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class SketchViewSet(viewsets.ModelViewSet):
    """
    CRUD operations for Sketches
    """
    queryset = Sketch.objects.all()
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        project_id = self.request.query_params.get('project_id')
        if project_id:
            return Sketch.objects.filter(project_id=project_id)
        return Sketch.objects.none()


class GeometryViewSet(viewsets.ModelViewSet):
    """
    CRUD operations for Geometries
    """
    queryset = Geometry.objects.all()
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        project_id = self.request.query_params.get('project_id')
        if project_id:
            return Geometry.objects.filter(project_id=project_id)
        return Geometry.objects.none()


class AssemblyViewSet(viewsets.ModelViewSet):
    """
    CRUD operations for Assemblies
    """
    queryset = Assembly.objects.all()
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        project_id = self.request.query_params.get('project_id')
        if project_id:
            return Assembly.objects.filter(project_id=project_id)
        return Assembly.objects.none()


class EventListView(ListAPIView):
    """
    List all events for a project (for audit trail)
    """
    queryset = EventStore.objects.all()
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        project_id = self.request.query_params.get('project_id')
        if project_id:
            return EventStore.objects.filter(project_id=project_id).order_by('-event_number')
        return EventStore.objects.none()


class UndoView(APIView):
    """
    Undo last operation
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        project_id = request.data.get('project_id')
        project = get_object_or_404(Project, id=project_id, owner=request.user)
        
        # Get current undo index from request
        undo_index = request.data.get('undo_index')
        
        success = EventStoreService.undo_operation(project, undo_index)
        return Response({'success': success}, status=status.HTTP_200_OK)


class RedoView(APIView):
    """
    Redo last undone operation
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        project_id = request.data.get('project_id')
        project = get_object_or_404(Project, id=project_id, owner=request.user)
        
        # Get redo index from request
        redo_index = request.data.get('redo_index')
        
        success = EventStoreService.redo_operation(project, redo_index)
        return Response({'success': success}, status=status.HTTP_200_OK)


class RegisterView(APIView):
    """
    User registration endpoint
    """
    permission_classes = [AllowAny]
    
    def post(self, request, *args, **kwargs):
        username = request.data.get('username')
        email = request.data.get('email')
        password = request.data.get('password')
        
        # Validation
        if not username or not email or not password:
            return Response(
                {'detail': 'Username, email, and password are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Check if user already exists
        if User.objects.filter(username=username).exists():
            return Response(
                {'detail': 'Username already exists'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if User.objects.filter(email=email).exists():
            return Response(
                {'detail': 'Email already exists'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create user
        try:
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password
            )
            
            # Generate tokens
            refresh = RefreshToken.for_user(user)
            
            return Response({
                'user': UserSerializer(user).data,
                'access': str(refresh.access_token),
                'refresh': str(refresh),
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {'detail': f'Error creating user: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )


class CurrentUserView(APIView):
    """
    Get current authenticated user
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, *args, **kwargs):
        return Response(UserSerializer(request.user).data)

