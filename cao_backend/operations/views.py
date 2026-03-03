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
from django.core.files.base import ContentFile
import uuid
import os
import tempfile


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
            
            # Export to STL
            stl_success, stl_path, stl_msg = bridge.export_stl(
                solid,
                f"extrude_{uuid.uuid4()}.stl"
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
            
            # Save STEP file to Django media directory
            if step_success and os.path.exists(step_path):
                try:
                    with open(step_path, 'rb') as f:
                        file_content = ContentFile(f.read())
                        geometry.step_file.save(
                            f"extrude_{uuid.uuid4()}.step",
                            file_content,
                            save=True
                        )
                except Exception as e:
                    print(f"Failed to save STEP file to media: {str(e)}")
                finally:
                    # Clean up temp file
                    try:
                        os.remove(step_path)
                    except:
                        pass
            
            # Save STL file to Django media directory
            if stl_success and os.path.exists(stl_path):
                try:
                    with open(stl_path, 'rb') as f:
                        file_content = ContentFile(f.read())
                        geometry.stl_file.save(
                            f"extrude_{uuid.uuid4()}.stl",
                            file_content,
                            save=True
                        )
                except Exception as e:
                    print(f"Failed to save STL file to media: {str(e)}")
                finally:
                    # Clean up temp file
                    try:
                        os.remove(stl_path)
                    except:
                        pass
            
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
            
            # Export to STL
            stl_success, stl_path, stl_msg = bridge.export_stl(
                solid,
                f"pocket_{uuid.uuid4()}.stl"
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
            
            # Save STEP file to Django media directory
            if step_success and os.path.exists(step_path):
                try:
                    with open(step_path, 'rb') as f:
                        file_content = ContentFile(f.read())
                        pocket_geometry.step_file.save(
                            f"pocket_{uuid.uuid4()}.step",
                            file_content,
                            save=True
                        )
                except Exception as e:
                    print(f"Failed to save STEP file to media: {str(e)}")
                finally:
                    # Clean up temp file
                    try:
                        os.remove(step_path)
                    except:
                        pass
            
            # Save STL file to Django media directory
            if stl_success and os.path.exists(stl_path):
                try:
                    with open(stl_path, 'rb') as f:
                        file_content = ContentFile(f.read())
                        pocket_geometry.stl_file.save(
                            f"pocket_{uuid.uuid4()}.stl",
                            file_content,
                            save=True
                        )
                except Exception as e:
                    print(f"Failed to save STL file to media: {str(e)}")
                finally:
                    # Clean up temp file
                    try:
                        os.remove(stl_path)
                    except:
                        pass
            
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


class FilletView(APIView):
    """
    Apply fillet to geometry edges
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            geometry_id = request.data.get('geometry_id')
            radius = request.data.get('radius', 1.0)
            project_id = request.data.get('project_id')
            
            # Validate inputs
            if not geometry_id or not project_id:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'geometry_id and project_id are required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if radius <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Radius must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get objects
            try:
                parent_geometry = Geometry.objects.get(id=geometry_id)
                project = Project.objects.get(id=project_id)
            except (Geometry.DoesNotExist, Project.DoesNotExist):
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Geometry or project not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Initialize CadQuery bridge
            bridge = CadQueryBridge()
            
            # Load the parent geometry from STEP file
            if not parent_geometry.step_file:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Parent geometry has no STEP file'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get the STEP file path
            step_filepath = parent_geometry.step_file.path
            
            # Load STEP file
            success, workplane, load_error = bridge.load_step(step_filepath)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Failed to load STEP file: {load_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Apply fillet
            success, filleted_solid, fillet_error = bridge.fillet(workplane, radius)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Fillet operation failed: {fillet_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Compute properties
            success, props, props_error = bridge.compute_properties(filleted_solid)
            
            # Export to STEP and STL
            step_success, step_path, step_error = bridge.export_step(
                filleted_solid,
                f'fillet_{uuid.uuid4()}.step'
            )
            stl_success, stl_path, stl_error = bridge.export_stl(
                filleted_solid,
                f'fillet_{uuid.uuid4()}.stl'
            )
            
            # Create new geometry record
            geometry = Geometry.objects.create(
                project=project,
                name=f'{parent_geometry.name}_Fillet',
                operation_type='fillet',
                parent_geometry=parent_geometry,
                parameters={'radius': radius},
                volume=props.get('volume'),
                bounding_box=props.get('bounding_box', {})
            )
            
            # Save STEP file
            if step_success and os.path.exists(step_path):
                with open(step_path, 'rb') as f:
                    geometry.step_file.save(
                        os.path.basename(step_path),
                        ContentFile(f.read())
                    )
                os.remove(step_path)
            
            # Save STL file
            if stl_success and os.path.exists(stl_path):
                with open(stl_path, 'rb') as f:
                    geometry.stl_file.save(
                        os.path.basename(stl_path),
                        ContentFile(f.read())
                    )
                os.remove(stl_path)
            
            geometry.save()
            
            return Response({
                'success': True,
                'geometry_id': str(geometry.id),
                'geometry_name': geometry.name,
                'properties': props,
                'message': f'Fillet of {radius}mm applied successfully'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'success': False,
                'geometry_id': None,
                'error': f'Fillet error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ChamferView(APIView):
    """
    Apply chamfer to geometry edges
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            geometry_id = request.data.get('geometry_id')
            size = request.data.get('size', 1.0)
            project_id = request.data.get('project_id')
            
            # Validate inputs
            if not geometry_id or not project_id:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'geometry_id and project_id are required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if size <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Size must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get objects
            try:
                parent_geometry = Geometry.objects.get(id=geometry_id)
                project = Project.objects.get(id=project_id)
            except (Geometry.DoesNotExist, Project.DoesNotExist):
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Geometry or project not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Initialize CadQuery bridge
            bridge = CadQueryBridge()
            
            # Load the parent geometry from STEP file
            if not parent_geometry.step_file:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Parent geometry has no STEP file'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get the STEP file path
            step_filepath = parent_geometry.step_file.path
            
            # Load STEP file
            success, workplane, load_error = bridge.load_step(step_filepath)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Failed to load STEP file: {load_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Apply chamfer
            success, chamfered_solid, chamfer_error = bridge.chamfer(workplane, size)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Chamfer operation failed: {chamfer_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Compute properties
            success, props, props_error = bridge.compute_properties(chamfered_solid)
            
            # Export to STEP and STL
            step_success, step_path, step_error = bridge.export_step(
                chamfered_solid,
                f'chamfer_{uuid.uuid4()}.step'
            )
            stl_success, stl_path, stl_error = bridge.export_stl(
                chamfered_solid,
                f'chamfer_{uuid.uuid4()}.stl'
            )
            
            # Create new geometry record
            geometry = Geometry.objects.create(
                project=project,
                name=f'{parent_geometry.name}_Chamfer',
                operation_type='chamfer',
                parent_geometry=parent_geometry,
                parameters={'size': size},
                volume=props.get('volume'),
                bounding_box=props.get('bounding_box', {})
            )
            
            # Save STEP file
            if step_success and os.path.exists(step_path):
                with open(step_path, 'rb') as f:
                    geometry.step_file.save(
                        os.path.basename(step_path),
                        ContentFile(f.read())
                    )
                os.remove(step_path)
            
            # Save STL file
            if stl_success and os.path.exists(stl_path):
                with open(stl_path, 'rb') as f:
                    geometry.stl_file.save(
                        os.path.basename(stl_path),
                        ContentFile(f.read())
                    )
                os.remove(stl_path)
            
            geometry.save()
            
            return Response({
                'success': True,
                'geometry_id': str(geometry.id),
                'geometry_name': geometry.name,
                'properties': props,
                'message': f'Chamfer of {size}mm applied successfully'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'success': False,
                'geometry_id': None,
                'error': f'Chamfer error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PadView(APIView):
    """
    Create a pad (additive feature) on an existing geometry
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            geometry_id = request.data.get('geometry_id')
            length = request.data.get('length', 10.0)
            face_index = request.data.get('face_index', 0)
            project_id = request.data.get('project_id')
            
            # Validate inputs
            if not geometry_id or not project_id:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'geometry_id and project_id are required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if length <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Pad length must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get objects
            try:
                parent_geometry = Geometry.objects.get(id=geometry_id)
                project = Project.objects.get(id=project_id)
            except (Geometry.DoesNotExist, Project.DoesNotExist):
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Geometry or project not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Initialize CadQuery bridge
            bridge = CadQueryBridge()
            
            # Load the parent geometry from STEP file
            if not parent_geometry.step_file:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Parent geometry has no STEP file'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get the STEP file path
            step_filepath = parent_geometry.step_file.path
            
            # Load STEP file
            success, workplane, load_error = bridge.load_step(step_filepath)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Failed to load STEP file: {load_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Apply pad
            success, padded_solid, pad_error = bridge.pad(workplane, face_index, length)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Pad operation failed: {pad_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Compute properties
            success, props, props_error = bridge.compute_properties(padded_solid)
            
            # Export to STEP and STL
            step_success, step_path, step_error = bridge.export_step(
                padded_solid,
                f'pad_{uuid.uuid4()}.step'
            )
            stl_success, stl_path, stl_error = bridge.export_stl(
                padded_solid,
                f'pad_{uuid.uuid4()}.stl'
            )
            
            # Create new geometry record
            geometry = Geometry.objects.create(
                project=project,
                name=f'{parent_geometry.name}_Pad',
                operation_type='pad',
                parent_geometry=parent_geometry,
                parameters={'length': length, 'face_index': face_index},
                volume=props.get('volume'),
                bounding_box=props.get('bounding_box', {})
            )
            
            # Save STEP file
            if step_success and os.path.exists(step_path):
                with open(step_path, 'rb') as f:
                    geometry.step_file.save(
                        os.path.basename(step_path),
                        ContentFile(f.read())
                    )
                os.remove(step_path)
            
            # Save STL file
            if stl_success and os.path.exists(stl_path):
                with open(stl_path, 'rb') as f:
                    geometry.stl_file.save(
                        os.path.basename(stl_path),
                        ContentFile(f.read())
                    )
                os.remove(stl_path)
            
            geometry.save()
            
            return Response({
                'success': True,
                'geometry_id': str(geometry.id),
                'geometry_name': geometry.name,
                'properties': props,
                'message': f'Pad of {length}mm created successfully'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'success': False,
                'geometry_id': None,
                'error': f'Pad error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class HoleView(APIView):
    """
    Create a hole (circular pocket) on an existing geometry
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            geometry_id = request.data.get('geometry_id')
            radius = request.data.get('radius', 5.0)
            depth = request.data.get('depth', 10.0)
            face_index = request.data.get('face_index', 0)
            project_id = request.data.get('project_id')
            
            # Validate inputs
            if not geometry_id or not project_id:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'geometry_id and project_id are required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if radius <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Hole radius must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if depth <= 0:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Hole depth must be positive'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get objects
            try:
                parent_geometry = Geometry.objects.get(id=geometry_id)
                project = Project.objects.get(id=project_id)
            except (Geometry.DoesNotExist, Project.DoesNotExist):
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Geometry or project not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Initialize CadQuery bridge
            bridge = CadQueryBridge()
            
            # Load the parent geometry from STEP file
            if not parent_geometry.step_file:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': 'Parent geometry has no STEP file'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get the STEP file path
            step_filepath = parent_geometry.step_file.path
            
            # Load STEP file
            success, workplane, load_error = bridge.load_step(step_filepath)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Failed to load STEP file: {load_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Apply hole
            success, hole_solid, hole_error = bridge.hole(workplane, face_index, radius, depth)
            if not success:
                return Response({
                    'success': False,
                    'geometry_id': None,
                    'error': f'Hole operation failed: {hole_error}'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Compute properties
            success, props, props_error = bridge.compute_properties(hole_solid)
            
            # Export to STEP and STL
            step_success, step_path, step_error = bridge.export_step(
                hole_solid,
                f'hole_{uuid.uuid4()}.step'
            )
            stl_success, stl_path, stl_error = bridge.export_stl(
                hole_solid,
                f'hole_{uuid.uuid4()}.stl'
            )
            
            # Create new geometry record
            geometry = Geometry.objects.create(
                project=project,
                name=f'{parent_geometry.name}_Hole',
                operation_type='hole',
                parent_geometry=parent_geometry,
                parameters={'radius': radius, 'depth': depth, 'face_index': face_index},
                volume=props.get('volume'),
                bounding_box=props.get('bounding_box', {})
            )
            
            # Save STEP file
            if step_success and os.path.exists(step_path):
                with open(step_path, 'rb') as f:
                    geometry.step_file.save(
                        os.path.basename(step_path),
                        ContentFile(f.read())
                    )
                os.remove(step_path)
            
            # Save STL file
            if stl_success and os.path.exists(stl_path):
                with open(stl_path, 'rb') as f:
                    geometry.stl_file.save(
                        os.path.basename(stl_path),
                        ContentFile(f.read())
                    )
                os.remove(stl_path)
            
            geometry.save()
            
            return Response({
                'success': True,
                'geometry_id': str(geometry.id),
                'geometry_name': geometry.name,
                'properties': props,
                'message': f'Hole of radius {radius}mm and depth {depth}mm created successfully'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'success': False,
                'geometry_id': None,
                'error': f'Hole error: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


