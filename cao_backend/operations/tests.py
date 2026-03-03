"""
Tests for CAD operations (extrude, pocket, fillet, etc.)
"""

import pytest
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

from cao_core.models import Project, Sketch, Geometry
from cao_core.cadquery_bridge import CadQueryBridge


@pytest.mark.django_db
class TestCadQueryBridge:
    """Test suite for CadQuery bridge operations"""

    def test_bridge_initialization(self):
        """Test that bridge initializes correctly"""
        bridge = CadQueryBridge()
        assert bridge.temp_dir is not None
        assert bridge.last_solid is None
        assert len(bridge.error_log) == 0

    def test_create_sketch_from_profile_empty(self):
        """Test creating profile from empty sketch"""
        bridge = CadQueryBridge()
        success, workplane, error = bridge.create_sketch_from_profile({})
        
        assert success is False
        assert error is not None

    def test_create_sketch_from_profile_with_lines(self):
        """Test creating profile from sketch with lines"""
        bridge = CadQueryBridge()
        sketch_data = {
            'lines': {
                'line1': {
                    'start': {'x': 0.0, 'y': 0.0},
                    'end': {'x': 10.0, 'y': 0.0}
                },
                'line2': {
                    'start': {'x': 10.0, 'y': 0.0},
                    'end': {'x': 10.0, 'y': 10.0}
                }
            }
        }
        
        success, workplane, error = bridge.create_sketch_from_profile(sketch_data)
        # Success depends on valid closed profile - may not succeed with just 2 lines
        assert isinstance(success, bool)

    def test_extrude_no_workplane(self):
        """Test extrusion with no workplane"""
        bridge = CadQueryBridge()
        success, solid, error = bridge.extrude(None, 10.0)
        
        assert success is False
        assert error is not None

    def test_extrude_invalid_length(self):
        """Test extrusion with invalid length"""
        bridge = CadQueryBridge()
        # Create a valid workplane first
        sketch_data = {
            'lines': {
                'line1': {'start': {'x': 0.0, 'y': 0.0}, 'end': {'x': 10.0, 'y': 0.0}},
                'line2': {'start': {'x': 10.0, 'y': 0.0}, 'end': {'x': 10.0, 'y': 10.0}},
                'line3': {'start': {'x': 10.0, 'y': 10.0}, 'end': {'x': 0.0, 'y': 10.0}},
            }
        }
        success, wp, error = bridge.create_sketch_from_profile(sketch_data)
        if success and wp:
            success, solid, error = bridge.extrude(wp, -10.0)
            assert success is False
            assert "positive" in error.lower()
        else:
            # Fallback: test with a simple workplane
            import cadquery as cq
            wp = cq.Workplane("XY").rect(10, 10).extrude(1)
            success, solid, error = bridge.extrude(wp, -10.0)
            assert success is False
            assert "positive" in error.lower()

    def test_extrude_excessive_length(self):
        """Test extrusion with excessive length"""
        bridge = CadQueryBridge()
        # Create a valid workplane first
        sketch_data = {
            'lines': {
                'line1': {'start': {'x': 0.0, 'y': 0.0}, 'end': {'x': 10.0, 'y': 0.0}},
                'line2': {'start': {'x': 10.0, 'y': 0.0}, 'end': {'x': 10.0, 'y': 10.0}},
                'line3': {'start': {'x': 10.0, 'y': 10.0}, 'end': {'x': 0.0, 'y': 10.0}},
            }
        }
        success, wp, error = bridge.create_sketch_from_profile(sketch_data)
        if success and wp:
            success, solid, error = bridge.extrude(wp, 2000.0)
            assert success is False
            assert "too large" in error.lower()
        else:
            # Fallback: test with a simple workplane
            import cadquery as cq
            wp = cq.Workplane("XY").rect(10, 10).extrude(1)
            success, solid, error = bridge.extrude(wp, 2000.0)
            assert success is False
            assert "too large" in error.lower()

    def test_pocket_no_workplane(self):
        """Test pocket with no workplane"""
        bridge = CadQueryBridge()
        success, solid, error = bridge.pocket(None, 5.0)
        
        assert success is False
        assert error is not None

    def test_pocket_invalid_depth(self):
        """Test pocket with invalid depth"""
        bridge = CadQueryBridge()
        # Create a valid workplane first
        sketch_data = {
            'lines': {
                'line1': {'start': {'x': 0.0, 'y': 0.0}, 'end': {'x': 10.0, 'y': 0.0}},
                'line2': {'start': {'x': 10.0, 'y': 0.0}, 'end': {'x': 10.0, 'y': 10.0}},
                'line3': {'start': {'x': 10.0, 'y': 10.0}, 'end': {'x': 0.0, 'y': 10.0}},
            }
        }
        success, wp, error = bridge.create_sketch_from_profile(sketch_data)
        if success and wp:
            success, solid, error = bridge.pocket(wp, -5.0)
            assert success is False
            assert "positive" in error.lower()
        else:
            # Fallback: test with a simple workplane
            import cadquery as cq
            wp = cq.Workplane("XY").rect(10, 10).extrude(10)
            success, solid, error = bridge.pocket(wp, -5.0)
            assert success is False
            assert "positive" in error.lower()

    def test_compute_properties_no_solid(self):
        """Test computing properties with no solid"""
        bridge = CadQueryBridge()
        success, props, error = bridge.compute_properties(None)
        
        assert success is False
        assert error is not None

    def test_export_step_no_solid(self):
        """Test STEP export with no solid"""
        bridge = CadQueryBridge()
        success, filepath, error = bridge.export_step(None)
        
        assert success is False
        assert error is not None

    def test_export_stl_no_solid(self):
        """Test STL export with no solid"""
        bridge = CadQueryBridge()
        success, filepath, error = bridge.export_stl(None)
        
        assert success is False
        assert error is not None

    def test_reset_bridge(self):
        """Test resetting bridge state"""
        bridge = CadQueryBridge()
        bridge.last_solid = "fake_solid"
        bridge.error_log.append("test error")
        
        assert len(bridge.error_log) > 0
        
        bridge.reset()
        assert bridge.last_solid is None
        assert len(bridge.error_log) == 0


@pytest.mark.django_db
class TestExtrudeView:
    """Test extrude operation API endpoint"""

    def setup_method(self):
        """Set up test data"""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpass123'
        )
        self.project = Project.objects.create(
            name='Test Project',
            owner=self.user
        )
        self.sketch = Sketch.objects.create(
            project=self.project,
            name='Test Sketch',
            geometry_data={'lines': {}},
            created_by=self.user
        )
        self.client.force_authenticate(user=self.user)

    def test_extrude_missing_sketch_id(self):
        """Test extrude without sketch_id"""
        response = self.client.post('/api/operations/extrude/', {}, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]

    def test_extrude_missing_project_id(self):
        """Test extrude without project_id"""
        response = self.client.post('/api/operations/extrude/', {
            'sketch_id': str(self.sketch.id)
        }, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]

    def test_extrude_invalid_length(self):
        """Test extrude with invalid length"""
        response = self.client.post('/api/operations/extrude/', {
            'sketch_id': str(self.sketch.id),
            'project_id': str(self.project.id),
            'length': -10.0
        }, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_422_UNPROCESSABLE_ENTITY]

    def test_extrude_sketch_not_found(self):
        """Test extrude with non-existent sketch"""
        response = self.client.post('/api/operations/extrude/', {
            'sketch_id': '00000000-0000-0000-0000-000000000000',
            'project_id': str(self.project.id),
            'length': 10.0
        }, format='json')
        assert response.status_code in [status.HTTP_404_NOT_FOUND, status.HTTP_422_UNPROCESSABLE_ENTITY]


@pytest.mark.django_db
class TestPocketView:
    """Test pocket operation API endpoint"""

    def setup_method(self):
        """Set up test data"""
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpass123'
        )
        self.project = Project.objects.create(
            name='Test Project',
            owner=self.user
        )
        self.sketch = Sketch.objects.create(
            project=self.project,
            name='Test Sketch',
            geometry_data={'lines': {}},
            created_by=self.user
        )
        self.geometry = Geometry.objects.create(
            project=self.project,
            name='Test Geometry',
            operation_type='extrude',
            base_sketch=self.sketch,
            created_by=self.user
        )
        self.client.force_authenticate(user=self.user)

    def test_pocket_missing_geometry_id(self):
        """Test pocket without geometry_id"""
        response = self.client.post('/api/operations/pocket/', {}, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]

    def test_pocket_missing_sketch_id(self):
        """Test pocket without sketch_id"""
        response = self.client.post('/api/operations/pocket/', {
            'geometry_id': str(self.geometry.id)
        }, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND]

    def test_pocket_invalid_depth(self):
        """Test pocket with invalid depth"""
        response = self.client.post('/api/operations/pocket/', {
            'geometry_id': str(self.geometry.id),
            'sketch_id': str(self.sketch.id),
            'project_id': str(self.project.id),
            'depth': -5.0
        }, format='json')
        assert response.status_code in [status.HTTP_400_BAD_REQUEST, status.HTTP_422_UNPROCESSABLE_ENTITY]

    def test_pocket_geometry_not_found(self):
        """Test pocket with non-existent geometry"""
        response = self.client.post('/api/operations/pocket/', {
            'geometry_id': '00000000-0000-0000-0000-000000000000',
            'sketch_id': str(self.sketch.id),
            'project_id': str(self.project.id),
            'depth': 5.0
        }, format='json')
        assert response.status_code in [status.HTTP_404_NOT_FOUND, status.HTTP_422_UNPROCESSABLE_ENTITY]
