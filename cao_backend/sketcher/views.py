"""
Views for sketcher app
2D Sketch validation and constraint solving
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from .services import SketchConstraintSolver


class ValidateSketchView(APIView):
    """
    Validate a 2D sketch
    Checks if sketch is closed, no self-intersections, etc.
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            sketch_data = request.data.get('sketch_data', {})
            
            if not sketch_data:
                return Response({
                    'valid': False,
                    'errors': ['No sketch data provided'],
                    'warnings': []
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Initialize solver
            solver = SketchConstraintSolver()
            
            # Validate sketch structure
            is_valid, errors = solver.validate_sketch()
            
            # Additional checks
            is_closed = solver.is_closed_profile()
            
            # Prepare response
            response_data = {
                'valid': is_valid and is_closed,
                'is_closed': is_closed,
                'errors': errors,
                'warnings': [],
                'geometry_data': solver.get_sketch_data() if is_valid else None
            }
            
            if not is_closed:
                response_data['warnings'].append('Sketch profile is not closed (required for extrusion)')
            
            status_code = status.HTTP_200_OK if response_data['valid'] else status.HTTP_422_UNPROCESSABLE_ENTITY
            
            return Response(response_data, status=status_code)
            
        except Exception as e:
            return Response({
                'valid': False,
                'errors': [f'Validation error: {str(e)}'],
                'warnings': []
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SolveConstraintsView(APIView):
    """
    Solve sketch constraints using Cassowary solver
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, *args, **kwargs):
        try:
            sketch_data = request.data.get('sketch_data', {})
            constraints_list = request.data.get('constraints', [])
            
            if not sketch_data:
                return Response({
                    'solved': False,
                    'geometry_data': None,
                    'errors': ['No sketch data provided'],
                    'solver_info': {}
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Initialize solver
            solver = SketchConstraintSolver()
            
            # Parse sketch geometry
            errors = []
            
            # Add points from geometry_data
            if 'points' in sketch_data:
                for point_name, point_data in sketch_data['points'].items():
                    try:
                        x = point_data.get('x', 0.0)
                        y = point_data.get('y', 0.0)
                        solver.add_point(point_name, x, y)
                    except Exception as e:
                        errors.append(f"Error adding point {point_name}: {str(e)}")
            
            # Add lines from geometry_data
            if 'lines' in sketch_data:
                for line_name, line_data in sketch_data['lines'].items():
                    try:
                        start_name = line_data.get('start', {}).get('name', '')
                        end_name = line_data.get('end', {}).get('name', '')
                        if start_name and end_name:
                            solver.add_line(line_name, start_name, end_name)
                    except Exception as e:
                        errors.append(f"Error adding line {line_name}: {str(e)}")
            
            # Add circles from geometry_data
            if 'circles' in sketch_data:
                for circle_name, circle_data in sketch_data['circles'].items():
                    try:
                        center_name = circle_data.get('center', {}).get('name', '')
                        radius = circle_data.get('radius', 1.0)
                        if center_name:
                            solver.add_circle(circle_name, center_name, radius)
                    except Exception as e:
                        errors.append(f"Error adding circle {circle_name}: {str(e)}")
            
            # Apply constraints
            for constraint in constraints_list:
                 try:
                     constraint_type = constraint.get('type', '')
                     
                     if constraint_type == 'horizontal':
                         solver.constrain_horizontal(constraint['line_name'])
                     elif constraint_type == 'vertical':
                         solver.constrain_vertical(constraint['line_name'])
                     elif constraint_type == 'length':
                         solver.constrain_length(constraint['line_name'], constraint['value'])
                     elif constraint_type == 'coincident':
                         solver.constrain_coincident(constraint['point1'], constraint['point2'])
                     elif constraint_type == 'parallel':
                         solver.constrain_parallel(constraint['line1'], constraint['line2'])
                     elif constraint_type == 'perpendicular':
                         solver.constrain_perpendicular(constraint['line1'], constraint['line2'])
                     elif constraint_type == 'position':
                         solver.constrain_distance(constraint['point'], constraint['x'], constraint['y'])
                     elif constraint_type == 'equal_length':
                         solver.constrain_equal_length(constraint['line1'], constraint['line2'])
                     elif constraint_type == 'angle':
                         solver.constrain_angle(constraint['line_name'], constraint['angle'])
                     elif constraint_type == 'symmetry':
                         solver.constrain_symmetry(
                             constraint['point1'], 
                             constraint['point2'], 
                             constraint.get('axis_type', 'vertical')
                         )
                     elif constraint_type == 'tangent':
                         solver.constrain_tangent(constraint['line_name'], constraint['circle_name'])
                     elif constraint_type == 'on_line':
                         solver.constrain_point_on_line(constraint['point_name'], constraint['line_name'])
                         
                 except Exception as e:
                     errors.append(f"Error applying constraint: {str(e)}")
            
            # Solve constraints
            solved, solve_message = solver.solve()
            
            # Get geometry data
            geometry_data = solver.get_sketch_data()
            
            response_data = {
                'solved': solved,
                'geometry_data': geometry_data,
                'errors': errors + solver.error_log,
                'solver_info': {
                    'constraints_applied': len(solver.constraints_applied),
                    'message': solve_message,
                    'profile_closed': solver.is_closed_profile()
                }
            }
            
            status_code = status.HTTP_200_OK if solved else status.HTTP_422_UNPROCESSABLE_ENTITY
            
            return Response(response_data, status=status_code)
            
        except Exception as e:
            return Response({
                'solved': False,
                'geometry_data': None,
                'errors': [f'Solver error: {str(e)}'],
                'solver_info': {}
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

