"""
Views for operations app
CAD operations: extrude, pocket, fillet, etc.
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from cao_core.models import Sketch, Geometry, Project
from cao_core.cadquery_bridge import CadQueryBridge
import uuid


class ExtrudeView(APIView):
    """
    Extrude a sketch to create a 3D geometry
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            sketch_id = request.data.get('sketch_id')
            length = request.data.get('length', 10.0)
            direction = request.data.get('direction', 'Z')
            is_symmetric = request.data.get('is_symmetric', False)
            project_id = request.data.get('project_id')
            
            # Validate inputs
            if not sketch_id or not project_id:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'sketch_id and project_id are required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if length <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Length must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get sketch
            try:
                sketch = Sketch.objects.get(id=sketch_id)
                project = Project.objects.get(id=project_id)
            except (Sketch.DoesNotExist, Project.DoesNotExist):
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Sketch or project not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Initialize CadQuery bridge
            bridge = CadQueryBridge()
            
            # Create profile from sketch
            success, workplane, error_msg = bridge.create_sketch_from_profile(
                sketch.geometry_data,
                plane='XY'
            )
            
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': error_msg
                }, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            
            # Apply extrusion
            success, solid, error_msg = bridge.extrude(
                workplane,
                length,
                direction,
                is_symmetric
            )
            
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': error_msg
                }, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            
            # Compute properties
            success, properties, error_msg = bridge.compute_properties(solid)
            
            # Export to STEP
            step_success, step_path, step_msg = bridge.export_step(
                solid,
                f"extrude_{uuid.uuid4()}.step"
            )
            
            # Create Geometry record
            geometry = Geometry.objects.create(
                project=project,
                name=sketch.name + "_Extrude",
                operation_type='extrude',
                base_sketch=sketch,
                parameters={
                    'length': length,
                    'direction': direction,
                    'is_symmetric': is_symmetric
                },
                volume=properties.get('volume'),
                bounding_box=properties.get('bounding_box', {}),
                is_valid=True,
                created_by=request.user
            )
            
            if step_success:
                geometry.step_file = step_path
                geometry.save()
            
            return Response({
                'success': True,
                'geometry_id': str(geometry.id),
                'geometry_name': geometry.name,
                'properties': properties,
                'message': f'Extrusion created successfully: {error_msg}'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'success': False,
                'geometry_id': None,
                'error': f'Extrusion error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PocketView(APIView):
    """
    Create a pocket (subtraction) from a geometry
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            geometry_id = request.data.get('geometry_id')
            sketch_id = request.data.get('sketch_id')
            depth = request.data.get('depth', 5.0)
            project_id = request.data.get('project_id')
            
            # Validate inputs
            if not geometry_id or not sketch_id or not project_id:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'geometry_id, sketch_id, and project_id are required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if depth <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Depth must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get objects
            try:
                parent_geometry = Geometry.objects.get(id=geometry_id)
                sketch = Sketch.objects.get(id=sketch_id)
                project = Project.objects.get(id=project_id)
            except (Geometry.DoesNotExist, Sketch.DoesNotExist, Project.DoesNotExist):
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Geometry, sketch, or project not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Initialize CadQuery bridge
            bridge = CadQueryBridge()
            
            # Create profile from sketch
            success, workplane, error_msg = bridge.create_sketch_from_profile(
                sketch.geometry_data,
                plane='XY'
            )
            
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': error_msg
                }, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            
            # Apply pocket
            success, solid, error_msg = bridge.pocket(
                workplane,
                depth
            )
            
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': error_msg
                }, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
            
            # Compute properties
            success, properties, error_msg = bridge.compute_properties(solid)
            
            # Export to STEP
            step_success, step_path, step_msg = bridge.export_step(
                solid,
                f"pocket_{uuid.uuid4()}.step"
            )
            
            # Create Geometry record
            pocket_geometry = Geometry.objects.create(
                project=project,
                name=parent_geometry.name + "_Pocket",
                operation_type='pocket',
                base_sketch=sketch,
                parent_geometry=parent_geometry,
                parameters={
                    'depth': depth,
                    'sketch_id': str(sketch_id)
                },
                volume=properties.get('volume'),
                bounding_box=properties.get('bounding_box', {}),
                is_valid=True,
                created_by=request.user
            )
            
            if step_success:
                pocket_geometry.step_file = step_path
                pocket_geometry.save()
            
            return Response({
                'success': True,
                'geometry_id': str(pocket_geometry.id),
                'geometry_name': pocket_geometry.name,
                'properties': properties,
                'message': f'Pocket created successfully: {error_msg}'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'success': False,
                'geometry_id': None,
                'error': f'Pocket error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

